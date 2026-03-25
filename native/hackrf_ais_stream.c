#define _POSIX_C_SOURCE 200809L

#include <errno.h>
#include <getopt.h>
#include <math.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <time.h>
#include <unistd.h>

#include <libhackrf/hackrf.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define AIS_BRANCH_COUNT 2
#define AIS_SYMBOL_RATE 9600U
#define AIS_BRANCH_RATE 96000U
#define AIS_SAMPLES_PER_SYMBOL 10U
#define AIS_MAX_RAW_BITS 1024
#define AIS_MAX_PAYLOAD_BITS 768
#define AIS_MAX_FRAME_BYTES (AIS_MAX_RAW_BITS / 8)
#define AIS_RECENT_FRAME_SLOTS 64

typedef struct {
    int length;
    int decim;
    int phase;
    int pos;
    double* taps;
    double* hist_i;
    double* hist_q;
} complex_fir_decimator_t;

typedef struct {
    bool have_prev_level;
    uint8_t prev_level;
    bool in_frame;
    uint8_t shift_reg;
    uint8_t raw_bits[AIS_MAX_RAW_BITS];
    int raw_len;
} ais_phase_decoder_t;

typedef struct {
    uint64_t hash;
    uint64_t seen_ms;
} recent_frame_t;

typedef struct {
    char label;
    int64_t channel_offset_hz;
    uint64_t channel_freq_hz;
    complex_fir_decimator_t decimator;
    double osc_cos;
    double osc_sin;
    double osc_step_cos;
    double osc_step_sin;
    uint32_t osc_renorm_counter;
    double prev_i;
    double prev_q;
    bool have_prev_iq;
    double dc_estimate;
    uint32_t symbol_phase;
    uint64_t output_sample_count;
    uint64_t accepted_frame_count;
    ais_phase_decoder_t phases[AIS_SAMPLES_PER_SYMBOL];
    recent_frame_t recent_frames[AIS_RECENT_FRAME_SLOTS];
    int recent_frame_pos;
} ais_branch_t;

typedef struct {
    hackrf_device* device;
    uint64_t center_freq_hz;
    uint32_t sample_rate;
    uint32_t branch_rate;
    uint32_t lna_gain;
    uint32_t vga_gain;
    bool stop_requested;
    ais_branch_t branches[AIS_BRANCH_COUNT];
} ais_state_t;

static volatile sig_atomic_t g_signal_stop = 0;

static void on_signal(int signum)
{
    (void) signum;
    g_signal_stop = 1;
}

static void usage(const char* argv0)
{
    fprintf(
        stderr,
        "Usage: %s [-f center_freq_hz] [-r sample_rate] [-l lna] [-g vga]\n",
        argv0);
}

static int parse_u64(const char* text, uint64_t* out_value)
{
    char* endptr = NULL;
    unsigned long long value = 0;

    errno = 0;
    value = strtoull(text, &endptr, 10);
    if (errno != 0 || endptr == text || *endptr != '\0') {
        return -1;
    }

    *out_value = (uint64_t) value;
    return 0;
}

static int parse_u32(const char* text, uint32_t* out_value)
{
    uint64_t value = 0;
    if (parse_u64(text, &value) != 0 || value > UINT32_MAX) {
        return -1;
    }

    *out_value = (uint32_t) value;
    return 0;
}

static int design_lowpass(double* taps, int length, double cutoff)
{
    double sum = 0.0;
    double middle = (double) (length - 1) / 2.0;
    int n = 0;

    if (cutoff <= 0.0 || cutoff >= 0.5) {
        return -1;
    }

    for (n = 0; n < length; n++) {
        double x = (double) n - middle;
        double sinc = 0.0;
        double window = 0.0;

        if (fabs(x) < 1e-12) {
            sinc = 2.0 * cutoff;
        } else {
            sinc = sin(2.0 * M_PI * cutoff * x) / (M_PI * x);
        }

        window = 0.54 - 0.46 * cos((2.0 * M_PI * (double) n) / (double) (length - 1));
        taps[n] = sinc * window;
        sum += taps[n];
    }

    if (fabs(sum) < 1e-12) {
        return -1;
    }

    for (n = 0; n < length; n++) {
        taps[n] /= sum;
    }

    return 0;
}

static int init_complex_fir_decimator(
    complex_fir_decimator_t* decimator,
    int length,
    int decim,
    double cutoff)
{
    memset(decimator, 0, sizeof(*decimator));
    decimator->length = length;
    decimator->decim = decim;
    decimator->taps = calloc((size_t) length, sizeof(double));
    decimator->hist_i = calloc((size_t) length, sizeof(double));
    decimator->hist_q = calloc((size_t) length, sizeof(double));

    if (!decimator->taps || !decimator->hist_i || !decimator->hist_q) {
        return -1;
    }

    return design_lowpass(decimator->taps, length, cutoff);
}

static void free_complex_fir_decimator(complex_fir_decimator_t* decimator)
{
    free(decimator->taps);
    free(decimator->hist_i);
    free(decimator->hist_q);
    memset(decimator, 0, sizeof(*decimator));
}

static bool process_complex_fir_decimator(
    complex_fir_decimator_t* decimator,
    double in_i,
    double in_q,
    double* out_i,
    double* out_q)
{
    int tap = 0;
    int idx = 0;

    decimator->hist_i[decimator->pos] = in_i;
    decimator->hist_q[decimator->pos] = in_q;
    decimator->pos = (decimator->pos + 1) % decimator->length;

    decimator->phase++;
    if (decimator->phase < decimator->decim) {
        return false;
    }
    decimator->phase = 0;

    *out_i = 0.0;
    *out_q = 0.0;
    idx = decimator->pos - 1;
    if (idx < 0) {
        idx = decimator->length - 1;
    }

    for (tap = 0; tap < decimator->length; tap++) {
        *out_i += decimator->taps[tap] * decimator->hist_i[idx];
        *out_q += decimator->taps[tap] * decimator->hist_q[idx];
        idx--;
        if (idx < 0) {
            idx = decimator->length - 1;
        }
    }

    return true;
}

static uint64_t monotonic_time_ms(void)
{
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) {
        return 0;
    }

    return (uint64_t) ts.tv_sec * 1000ULL + (uint64_t) ts.tv_nsec / 1000000ULL;
}

static void realtime_iso8601(char* buffer, size_t buffer_len)
{
    struct timespec ts;
    struct tm tm_value;
    int milliseconds = 0;

    if (!buffer || buffer_len == 0) {
        return;
    }

    if (clock_gettime(CLOCK_REALTIME, &ts) != 0 || !gmtime_r(&ts.tv_sec, &tm_value)) {
        snprintf(buffer, buffer_len, "1970-01-01T00:00:00.000Z");
        return;
    }

    milliseconds = (int) (ts.tv_nsec / 1000000L);

    snprintf(
        buffer,
        buffer_len,
        "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
        tm_value.tm_year + 1900,
        tm_value.tm_mon + 1,
        tm_value.tm_mday,
        tm_value.tm_hour,
        tm_value.tm_min,
        tm_value.tm_sec,
        milliseconds);
}

static uint64_t hash_bytes(const uint8_t* bytes, int length)
{
    uint64_t hash = 1469598103934665603ULL;
    int index = 0;

    for (index = 0; index < length; index++) {
        hash ^= (uint64_t) bytes[index];
        hash *= 1099511628211ULL;
    }

    hash ^= (uint64_t) length;
    hash *= 1099511628211ULL;

    return hash;
}

static bool is_recent_duplicate(ais_branch_t* branch, uint64_t hash, uint64_t now_ms)
{
    int index = 0;

    for (index = 0; index < AIS_RECENT_FRAME_SLOTS; index++) {
        if (branch->recent_frames[index].hash == hash
            && now_ms >= branch->recent_frames[index].seen_ms
            && now_ms - branch->recent_frames[index].seen_ms <= 750ULL) {
            return true;
        }
    }

    branch->recent_frames[branch->recent_frame_pos].hash = hash;
    branch->recent_frames[branch->recent_frame_pos].seen_ms = now_ms;
    branch->recent_frame_pos = (branch->recent_frame_pos + 1) % AIS_RECENT_FRAME_SLOTS;
    return false;
}

static int destuff_bits(const uint8_t* input, int input_len, uint8_t* output, int output_cap)
{
    int ones = 0;
    int out_len = 0;
    int index = 0;

    for (index = 0; index < input_len; index++) {
        uint8_t bit = input[index] ? 1U : 0U;

        if (bit) {
            ones++;
            if (ones > 5) {
                return -1;
            }
            if (out_len >= output_cap) {
                return -1;
            }
            output[out_len++] = 1U;
            continue;
        }

        if (ones == 5) {
            ones = 0;
            continue;
        }

        ones = 0;
        if (out_len >= output_cap) {
            return -1;
        }
        output[out_len++] = 0U;
    }

    return out_len;
}

static int bits_to_lsb_bytes(const uint8_t* bits, int bit_len, uint8_t* bytes, int bytes_cap)
{
    int byte_len = 0;
    int byte_index = 0;

    if (bit_len <= 0 || (bit_len % 8) != 0) {
        return -1;
    }

    byte_len = bit_len / 8;
    if (byte_len > bytes_cap) {
        return -1;
    }

    for (byte_index = 0; byte_index < byte_len; byte_index++) {
        uint8_t value = 0U;
        int bit_index = 0;

        for (bit_index = 0; bit_index < 8; bit_index++) {
            if (bits[byte_index * 8 + bit_index]) {
                value |= (uint8_t) (1U << bit_index);
            }
        }

        bytes[byte_index] = value;
    }

    return byte_len;
}

static uint16_t crc16_x25_update(uint16_t crc, uint8_t value)
{
    int bit = 0;

    crc ^= (uint16_t) value;
    for (bit = 0; bit < 8; bit++) {
        if (crc & 1U) {
            crc = (uint16_t) ((crc >> 1U) ^ 0x8408U);
        } else {
            crc >>= 1U;
        }
    }

    return crc;
}

static bool validate_hdlc_fcs(const uint8_t* frame_bytes, int frame_len)
{
    uint16_t crc = 0xFFFFU;
    int index = 0;

    if (frame_len < 3) {
        return false;
    }

    for (index = 0; index < frame_len; index++) {
        crc = crc16_x25_update(crc, frame_bytes[index]);
    }

    return crc == 0xF0B8U;
}

static void emit_frame_event(
    ais_branch_t* branch,
    int phase,
    const uint8_t* payload_bytes,
    int payload_byte_len)
{
    char bit_text[AIS_MAX_PAYLOAD_BITS + 1];
    char timestamp[64];
    uint64_t hash = 0;
    uint64_t now_ms = monotonic_time_ms();
    int index = 0;
    int bit_len = payload_byte_len * 8;
    int out_pos = 0;

    if (payload_byte_len <= 0 || bit_len > AIS_MAX_PAYLOAD_BITS) {
        return;
    }

    for (index = 0; index < payload_byte_len; index++) {
        int bit = 0;

        for (bit = 7; bit >= 0; bit--) {
            bit_text[out_pos++] =
                (payload_bytes[index] & (uint8_t) (1U << bit)) ? '1' : '0';
        }
    }
    bit_text[bit_len] = '\0';

    hash = hash_bytes(payload_bytes, payload_byte_len);
    if (is_recent_duplicate(branch, hash, now_ms)) {
        return;
    }

    realtime_iso8601(timestamp, sizeof(timestamp));
    fprintf(
        stdout,
        "{\"event\":\"frame\",\"channel\":\"%c\",\"phase\":%d,\"receivedAt\":\"%s\",\"bitLength\":%d,\"payloadBits\":\"%s\"}\n",
        branch->label,
        phase,
        timestamp,
        bit_len,
        bit_text);
    fflush(stdout);
    branch->accepted_frame_count++;
}

static void process_completed_frame(ais_branch_t* branch, int phase, const uint8_t* raw_bits, int raw_len)
{
    uint8_t frame_bits[AIS_MAX_RAW_BITS];
    uint8_t frame_bytes[AIS_MAX_FRAME_BYTES];
    int frame_bit_len = 0;
    int frame_byte_len = 0;
    int payload_byte_len = 0;

    if (raw_len < 64 || raw_len > AIS_MAX_RAW_BITS) {
        return;
    }

    frame_bit_len = destuff_bits(raw_bits, raw_len, frame_bits, AIS_MAX_RAW_BITS);
    if (frame_bit_len <= 16 || (frame_bit_len % 8) != 0) {
        return;
    }

    frame_byte_len = bits_to_lsb_bytes(frame_bits, frame_bit_len, frame_bytes, AIS_MAX_FRAME_BYTES);
    if (frame_byte_len < 3 || !validate_hdlc_fcs(frame_bytes, frame_byte_len)) {
        return;
    }

    payload_byte_len = frame_byte_len - 2;
    if ((payload_byte_len * 8) < 32) {
        return;
    }

    emit_frame_event(branch, phase, frame_bytes, payload_byte_len);
}

static void phase_push_bit(ais_branch_t* branch, ais_phase_decoder_t* decoder, int phase, uint8_t bit)
{
    decoder->shift_reg = (uint8_t) (((uint32_t) decoder->shift_reg << 1U) | (uint32_t) (bit & 1U));

    if (!decoder->in_frame) {
        if (decoder->shift_reg == 0x7eU) {
            decoder->in_frame = true;
            decoder->raw_len = 0;
        }
        return;
    }

    if (decoder->raw_len >= AIS_MAX_RAW_BITS) {
        decoder->in_frame = false;
        decoder->raw_len = 0;
        return;
    }

    decoder->raw_bits[decoder->raw_len++] = bit & 1U;

    if (decoder->shift_reg == 0x7eU) {
        if (decoder->raw_len >= 8) {
            process_completed_frame(branch, phase, decoder->raw_bits, decoder->raw_len - 8);
        }
        decoder->raw_len = 0;
        decoder->in_frame = true;
    }
}

static void process_branch_decimated_sample(ais_branch_t* branch, double sample)
{
    double dc_alpha = 0.0015;
    int phase_index = (int) branch->symbol_phase;
    ais_phase_decoder_t* decoder = NULL;
    uint8_t level = 0;
    uint8_t bit = 0;

    branch->dc_estimate += dc_alpha * (sample - branch->dc_estimate);
    sample -= branch->dc_estimate;
    branch->symbol_phase++;
    if (branch->symbol_phase >= AIS_SAMPLES_PER_SYMBOL) {
        branch->symbol_phase = 0U;
    }
    branch->output_sample_count++;

    decoder = &branch->phases[phase_index];
    level = sample >= 0.0 ? 1U : 0U;

    if (!decoder->have_prev_level) {
        decoder->prev_level = level;
        decoder->have_prev_level = true;
        return;
    }

    bit = (decoder->prev_level == level) ? 1U : 0U;
    decoder->prev_level = level;
    phase_push_bit(branch, decoder, phase_index, bit);
}

static void process_branch_sample(ais_branch_t* branch, int8_t raw_i, int8_t raw_q)
{
    double mixed_i = 0.0;
    double mixed_q = 0.0;
    double filtered_i = 0.0;
    double filtered_q = 0.0;
    double demod = 0.0;
    double dot = 0.0;
    double cross = 0.0;
    double next_cos = 0.0;
    double next_sin = 0.0;

    mixed_i = (double) raw_i * branch->osc_cos - (double) raw_q * branch->osc_sin;
    mixed_q = (double) raw_i * branch->osc_sin + (double) raw_q * branch->osc_cos;

    next_cos = branch->osc_cos * branch->osc_step_cos - branch->osc_sin * branch->osc_step_sin;
    next_sin = branch->osc_sin * branch->osc_step_cos + branch->osc_cos * branch->osc_step_sin;
    branch->osc_cos = next_cos;
    branch->osc_sin = next_sin;
    branch->osc_renorm_counter++;

    if ((branch->osc_renorm_counter & 4095U) == 0U) {
        double inv_mag = 1.0 / hypot(branch->osc_cos, branch->osc_sin);
        branch->osc_cos *= inv_mag;
        branch->osc_sin *= inv_mag;
    }

    if (!process_complex_fir_decimator(&branch->decimator, mixed_i, mixed_q, &filtered_i, &filtered_q)) {
        return;
    }

    if (!branch->have_prev_iq) {
        branch->prev_i = filtered_i;
        branch->prev_q = filtered_q;
        branch->have_prev_iq = true;
        return;
    }

    dot = branch->prev_i * filtered_i + branch->prev_q * filtered_q;
    cross = branch->prev_i * filtered_q - branch->prev_q * filtered_i;
    if (fabs(dot) < 1e-12 && fabs(cross) < 1e-12) {
        branch->prev_i = filtered_i;
        branch->prev_q = filtered_q;
        return;
    }

    demod = atan2(cross, dot);

    branch->prev_i = filtered_i;
    branch->prev_q = filtered_q;
    process_branch_decimated_sample(branch, demod);
}

static int rx_callback(hackrf_transfer* transfer)
{
    ais_state_t* state = (ais_state_t*) transfer->rx_ctx;
    int8_t* signed_buffer = (int8_t*) transfer->buffer;
    int index = 0;
    int branch_index = 0;

    if (g_signal_stop || state->stop_requested) {
        return 1;
    }

    for (index = 0; index + 1 < transfer->valid_length; index += 2) {
        for (branch_index = 0; branch_index < AIS_BRANCH_COUNT; branch_index++) {
            process_branch_sample(&state->branches[branch_index], signed_buffer[index], signed_buffer[index + 1]);
        }

        if (g_signal_stop || state->stop_requested) {
            return 1;
        }
    }

    return 0;
}

static int init_branch(ais_state_t* state, ais_branch_t* branch, char label, int64_t channel_offset_hz)
{
    double mix_hz = (double) (-channel_offset_hz);
    double step = 0.0;
    double cutoff = 12000.0 / (double) state->sample_rate;
    int index = 0;

    memset(branch, 0, sizeof(*branch));
    branch->label = label;
    branch->channel_offset_hz = channel_offset_hz;
    branch->channel_freq_hz = state->center_freq_hz + channel_offset_hz;
    branch->osc_cos = 1.0;
    branch->osc_sin = 0.0;
    step = 2.0 * M_PI * (mix_hz / (double) state->sample_rate);
    branch->osc_step_cos = cos(step);
    branch->osc_step_sin = sin(step);

    if (init_complex_fir_decimator(
            &branch->decimator,
            129,
            (int) (state->sample_rate / state->branch_rate),
            cutoff)
        != 0) {
        fprintf(stderr, "Failed to initialize AIS branch %c decimator\n", label);
        return -1;
    }

    for (index = 0; index < (int) AIS_SAMPLES_PER_SYMBOL; index++) {
        branch->phases[index].shift_reg = 0U;
    }

    return 0;
}

static void free_branch(ais_branch_t* branch)
{
    free_complex_fir_decimator(&branch->decimator);
    memset(branch, 0, sizeof(*branch));
}

static int configure_state(ais_state_t* state)
{
    if (state->sample_rate == 0) {
        state->sample_rate = 1536000U;
    }
    if (state->branch_rate == 0) {
        state->branch_rate = AIS_BRANCH_RATE;
    }
    if (state->center_freq_hz == 0) {
        state->center_freq_hz = 162000000ULL;
    }

    if (state->branch_rate != AIS_BRANCH_RATE) {
        fprintf(stderr, "branch_rate must remain %u to keep AIS symbol alignment stable\n", AIS_BRANCH_RATE);
        return -1;
    }
    if (state->sample_rate % state->branch_rate != 0U) {
        fprintf(stderr, "sample_rate=%u must be divisible by branch_rate=%u\n", state->sample_rate, state->branch_rate);
        return -1;
    }

    if (init_branch(state, &state->branches[0], 'A', -25000) != 0) {
        return -1;
    }
    if (init_branch(state, &state->branches[1], 'B', 25000) != 0) {
        free_branch(&state->branches[0]);
        return -1;
    }

    return 0;
}

static void cleanup_state(ais_state_t* state)
{
    free_branch(&state->branches[0]);
    free_branch(&state->branches[1]);
}

int main(int argc, char** argv)
{
    ais_state_t state;
    uint32_t bandwidth = 0;
    int result = HACKRF_SUCCESS;
    int opt = 0;

    memset(&state, 0, sizeof(state));
    state.center_freq_hz = 162000000ULL;
    state.sample_rate = 1536000U;
    state.branch_rate = AIS_BRANCH_RATE;
    state.lna_gain = 40U;
    state.vga_gain = 40U;

    while ((opt = getopt(argc, argv, "f:r:l:g:h")) != -1) {
        switch (opt) {
        case 'f':
            if (parse_u64(optarg, &state.center_freq_hz) != 0) {
                fprintf(stderr, "Invalid center frequency: %s\n", optarg);
                return 1;
            }
            break;
        case 'r':
            if (parse_u32(optarg, &state.sample_rate) != 0) {
                fprintf(stderr, "Invalid sample rate: %s\n", optarg);
                return 1;
            }
            break;
        case 'l':
            if (parse_u32(optarg, &state.lna_gain) != 0) {
                fprintf(stderr, "Invalid LNA gain: %s\n", optarg);
                return 1;
            }
            break;
        case 'g':
            if (parse_u32(optarg, &state.vga_gain) != 0) {
                fprintf(stderr, "Invalid VGA gain: %s\n", optarg);
                return 1;
            }
            break;
        case 'h':
        default:
            usage(argv[0]);
            return opt == 'h' ? 0 : 1;
        }
    }

    if (configure_state(&state) != 0) {
        cleanup_state(&state);
        return 1;
    }

    setvbuf(stdout, NULL, _IOLBF, 0);
    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);
    signal(SIGPIPE, SIG_IGN);

    result = hackrf_init();
    if (result != HACKRF_SUCCESS) {
        fprintf(stderr, "hackrf_init() failed: %s\n", hackrf_error_name(result));
        cleanup_state(&state);
        return 1;
    }

    result = hackrf_open(&state.device);
    if (result != HACKRF_SUCCESS) {
        fprintf(stderr, "hackrf_open() failed: %s\n", hackrf_error_name(result));
        hackrf_exit();
        cleanup_state(&state);
        return 1;
    }

    result = hackrf_set_sample_rate(state.device, state.sample_rate);
    if (result != HACKRF_SUCCESS) {
        fprintf(stderr, "hackrf_set_sample_rate() failed: %s\n", hackrf_error_name(result));
        goto cleanup;
    }

    bandwidth = hackrf_compute_baseband_filter_bw((uint32_t) ((state.sample_rate * 3U) / 4U));
    result = hackrf_set_baseband_filter_bandwidth(state.device, bandwidth);
    if (result != HACKRF_SUCCESS) {
        fprintf(stderr, "hackrf_set_baseband_filter_bandwidth() failed: %s\n", hackrf_error_name(result));
        goto cleanup;
    }

    result = hackrf_set_freq(state.device, state.center_freq_hz);
    if (result != HACKRF_SUCCESS) {
        fprintf(stderr, "hackrf_set_freq() failed: %s\n", hackrf_error_name(result));
        goto cleanup;
    }

    result = hackrf_set_amp_enable(state.device, 0);
    if (result != HACKRF_SUCCESS) {
        fprintf(stderr, "hackrf_set_amp_enable() failed: %s\n", hackrf_error_name(result));
        goto cleanup;
    }

    result = hackrf_set_lna_gain(state.device, state.lna_gain);
    if (result != HACKRF_SUCCESS) {
        fprintf(stderr, "hackrf_set_lna_gain() failed: %s\n", hackrf_error_name(result));
        goto cleanup;
    }

    result = hackrf_set_vga_gain(state.device, state.vga_gain);
    if (result != HACKRF_SUCCESS) {
        fprintf(stderr, "hackrf_set_vga_gain() failed: %s\n", hackrf_error_name(result));
        goto cleanup;
    }

    fprintf(
        stderr,
        "AIS listening center=%.6f MHz channelA=%.6f MHz channelB=%.6f MHz sample_rate=%u branch_rate=%u lna=%u vga=%u\n",
        state.center_freq_hz / 1e6,
        state.branches[0].channel_freq_hz / 1e6,
        state.branches[1].channel_freq_hz / 1e6,
        state.sample_rate,
        state.branch_rate,
        state.lna_gain,
        state.vga_gain);
    fflush(stderr);

    result = hackrf_start_rx(state.device, rx_callback, &state);
    if (result != HACKRF_SUCCESS) {
        fprintf(stderr, "hackrf_start_rx() failed: %s\n", hackrf_error_name(result));
        goto cleanup;
    }

    while (!g_signal_stop && !state.stop_requested && hackrf_is_streaming(state.device) == HACKRF_TRUE) {
        struct timespec sleep_time = {0, 5000000};
        nanosleep(&sleep_time, NULL);
    }

    hackrf_stop_rx(state.device);

cleanup:
    if (state.device) {
        hackrf_close(state.device);
    }
    hackrf_exit();
    cleanup_state(&state);
    return result == HACKRF_SUCCESS ? 0 : 1;
}
