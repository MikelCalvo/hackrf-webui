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

typedef enum {
    DEMOD_AM = 0,
    DEMOD_NFM = 1,
    DEMOD_WFM = 2,
} demod_mode_t;

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
    int length;
    int decim;
    int phase;
    int pos;
    double* taps;
    double* hist;
} real_fir_decimator_t;

typedef struct {
    hackrf_device* device;
    demod_mode_t mode;
    uint64_t freq_hz;
    uint64_t tuned_freq_hz;
    uint32_t sample_rate;
    uint32_t rf_rate;
    uint32_t audio_rate;
    uint32_t lna_gain;
    uint32_t vga_gain;
    double audio_gain;
    uint64_t tune_offset_hz;
    uint32_t rf_cutoff_hz;
    uint32_t audio_cutoff_hz;
    uint64_t duration_samples;
    double duration_seconds;
    bool finite_duration;
    bool stop_requested;
    bool mute_audio;
    char* record_path;
    FILE* record_fp;
    uint64_t recorded_audio_samples;
    char* record_iq_path;
    FILE* record_iq_fp;
    uint64_t recorded_iq_bytes;
    char* record_activity_prefix;
    double record_activity_threshold;
    uint64_t record_activity_interval_samples;
    uint64_t record_activity_window_count;
    double record_activity_window_sum_sq;
    uint64_t record_activity_hold_samples;
    uint64_t record_activity_last_seen_sample;
    uint32_t record_activity_warmup_windows;
    uint32_t report_interval_ms;
    uint64_t report_interval_samples;
    uint64_t report_count;
    double report_sum_sq;
    double report_peak;
    double report_rf_sum_sq;
    uint64_t report_rf_count;

    complex_fir_decimator_t rf_decimator;
    real_fir_decimator_t audio_decimator;

    double osc_cos;
    double osc_sin;
    double osc_step_cos;
    double osc_step_sin;
    uint32_t osc_renorm_counter;

    double prev_i;
    double prev_q;
    bool have_prev_iq;

    double dc_estimate;
    double hp_prev_x;
    double hp_prev_y;
    double deemph_y;
    double deemph_alpha;
    double agc_level;
    uint64_t emitted_audio_samples;
} stream_state_t;

static volatile sig_atomic_t g_signal_stop = 0;

static void on_signal(int signum)
{
    (void) signum;
    g_signal_stop = 1;
}

static void usage(const char* argv0)
{
    fprintf(stderr,
        "Usage: %s -f <freq_hz> [-m am|nfm|wfm] [-l lna] [-g vga] [-G gain] [-r sample_rate] [-a audio_rate] [-t seconds] [-R report_ms] [-o wav_path] [-q iq_path] [-P activity_prefix] [-Q]\n",
        argv0);
}

static const char* mode_name(demod_mode_t mode)
{
    switch (mode) {
    case DEMOD_AM:
        return "am";
    case DEMOD_NFM:
        return "nfm";
    case DEMOD_WFM:
        return "wfm";
    }
    return "unknown";
}

static double default_activity_threshold(demod_mode_t mode)
{
    switch (mode) {
    case DEMOD_AM:
        return 0.012;
    case DEMOD_NFM:
        return 0.004;
    case DEMOD_WFM:
        return 0.020;
    }
    return 0.010;
}

static int parse_mode(const char* text, demod_mode_t* out_mode)
{
    if (strcasecmp(text, "am") == 0) {
        *out_mode = DEMOD_AM;
        return 0;
    }
    if (strcasecmp(text, "nfm") == 0 || strcasecmp(text, "fm") == 0) {
        *out_mode = DEMOD_NFM;
        return 0;
    }
    if (strcasecmp(text, "wfm") == 0) {
        *out_mode = DEMOD_WFM;
        return 0;
    }
    return -1;
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

static int parse_double_value(const char* text, double* out_value)
{
    char* endptr = NULL;
    double value = 0.0;

    errno = 0;
    value = strtod(text, &endptr);
    if (errno != 0 || endptr == text || *endptr != '\0') {
        return -1;
    }

    *out_value = value;
    return 0;
}

static int clamp_pcm16(double sample)
{
    if (sample > 32767.0) {
        return 32767;
    }
    if (sample < -32768.0) {
        return -32768;
    }
    return (int) lrint(sample);
}

static int write_u16le(FILE* fp, uint16_t value)
{
    unsigned char bytes[2];
    bytes[0] = (unsigned char) (value & 0xffU);
    bytes[1] = (unsigned char) ((value >> 8U) & 0xffU);
    return fwrite(bytes, sizeof(bytes), 1, fp) == 1 ? 0 : -1;
}

static int write_u32le(FILE* fp, uint32_t value)
{
    unsigned char bytes[4];
    bytes[0] = (unsigned char) (value & 0xffU);
    bytes[1] = (unsigned char) ((value >> 8U) & 0xffU);
    bytes[2] = (unsigned char) ((value >> 16U) & 0xffU);
    bytes[3] = (unsigned char) ((value >> 24U) & 0xffU);
    return fwrite(bytes, sizeof(bytes), 1, fp) == 1 ? 0 : -1;
}

static int write_pcm16le(FILE* fp, int16_t sample)
{
    return write_u16le(fp, (uint16_t) sample);
}

static int write_wav_header(FILE* fp, uint32_t sample_rate, uint16_t channels, uint16_t bits_per_sample, uint64_t sample_count)
{
    uint64_t bytes_per_sample = (uint64_t) channels * (uint64_t) bits_per_sample / 8ULL;
    uint64_t data_size_u64 = sample_count * bytes_per_sample;
    uint32_t data_size = data_size_u64 > UINT32_MAX ? UINT32_MAX : (uint32_t) data_size_u64;
    uint32_t riff_size = data_size > UINT32_MAX - 36U ? UINT32_MAX : data_size + 36U;
    uint32_t byte_rate = sample_rate * (uint32_t) channels * (uint32_t) bits_per_sample / 8U;
    uint16_t block_align = (uint16_t) (channels * bits_per_sample / 8U);

    if (fseek(fp, 0, SEEK_SET) != 0) {
        return -1;
    }
    if (fwrite("RIFF", 4, 1, fp) != 1) {
        return -1;
    }
    if (write_u32le(fp, riff_size) != 0) {
        return -1;
    }
    if (fwrite("WAVEfmt ", 8, 1, fp) != 1) {
        return -1;
    }
    if (write_u32le(fp, 16U) != 0 || write_u16le(fp, 1U) != 0 || write_u16le(fp, channels) != 0) {
        return -1;
    }
    if (write_u32le(fp, sample_rate) != 0 || write_u32le(fp, byte_rate) != 0 || write_u16le(fp, block_align) != 0) {
        return -1;
    }
    if (write_u16le(fp, bits_per_sample) != 0) {
        return -1;
    }
    if (fwrite("data", 4, 1, fp) != 1) {
        return -1;
    }
    if (write_u32le(fp, data_size) != 0) {
        return -1;
    }
    return 0;
}

static int open_recording(stream_state_t* state)
{
    if (!state->record_path || !*state->record_path) {
        return 0;
    }
    state->record_fp = fopen(state->record_path, "wb");
    if (!state->record_fp) {
        fprintf(stderr, "Failed to open recording file %s: %s\n", state->record_path, strerror(errno));
        return -1;
    }
    if (write_wav_header(state->record_fp, state->audio_rate, 1U, 16U, 0) != 0) {
        fprintf(stderr, "Failed to write WAV header to %s\n", state->record_path);
        fclose(state->record_fp);
        state->record_fp = NULL;
        return -1;
    }
    return 0;
}

static void close_recording(stream_state_t* state)
{
    if (!state->record_fp) {
        free(state->record_path);
        state->record_path = NULL;
        return;
    }
    if (write_wav_header(state->record_fp, state->audio_rate, 1U, 16U, state->recorded_audio_samples) != 0) {
        fprintf(stderr, "Failed to finalize WAV header for %s\n", state->record_path ? state->record_path : "(recording)");
    }
    fclose(state->record_fp);
    state->record_fp = NULL;
    free(state->record_path);
    state->record_path = NULL;
}

static int open_iq_recording(stream_state_t* state)
{
    if (!state->record_iq_path || !*state->record_iq_path) {
        return 0;
    }
    state->record_iq_fp = fopen(state->record_iq_path, "wb");
    if (!state->record_iq_fp) {
        fprintf(stderr, "Failed to open IQ recording file %s: %s\n", state->record_iq_path, strerror(errno));
        return -1;
    }
    return 0;
}

static void close_iq_recording(stream_state_t* state)
{
    if (!state->record_iq_fp) {
        free(state->record_iq_path);
        state->record_iq_path = NULL;
        return;
    }
    fclose(state->record_iq_fp);
    state->record_iq_fp = NULL;
    free(state->record_iq_path);
    state->record_iq_path = NULL;
}

static int make_activity_stamp(char* stamp, size_t stamp_len)
{
    struct timespec now_ts;
    struct tm now_tm;
    size_t base_len = 0;

    if (!stamp || stamp_len < 20) {
        return -1;
    }

    if (clock_gettime(CLOCK_REALTIME, &now_ts) != 0) {
        return -1;
    }
    if (!localtime_r(&now_ts.tv_sec, &now_tm)) {
        return -1;
    }

    if (strftime(stamp, stamp_len, "%Y%m%d_%H%M%S", &now_tm) == 0) {
        return -1;
    }
    base_len = strlen(stamp);
    if (base_len + 3 >= stamp_len) {
        return -1;
    }
    snprintf(stamp + base_len, stamp_len - base_len, "%03ld", now_ts.tv_nsec / 1000000L);
    return 0;
}

static int build_activity_segment_path(const char* prefix, const char* stamp, const char* extension, char** out_path)
{
    const char* base = prefix;
    const char* slash = strrchr(prefix, '/');
    size_t dir_len = 0;
    char* path = NULL;
    size_t total_len = 0;

    if (!prefix || !*prefix || !stamp || !*stamp || !extension || !*extension || !out_path) {
        return -1;
    }

    if (slash) {
        dir_len = (size_t) (slash - prefix + 1);
        base = slash + 1;
    }

    total_len = dir_len + strlen(stamp) + 1 + strlen(base) + 1 + strlen(extension) + 1;
    path = malloc(total_len);
    if (!path) {
        return -1;
    }

    if (dir_len > 0) {
        memcpy(path, prefix, dir_len);
    }
    snprintf(path + dir_len, total_len - dir_len, "%s_%s.%s", stamp, base, extension);
    *out_path = path;
    return 0;
}

static int open_activity_recordings(stream_state_t* state)
{
    char* wav_path = NULL;
    char* iq_path = NULL;
    char stamp[32];

    if (!state->record_activity_prefix || !*state->record_activity_prefix) {
        return 0;
    }
    if (state->record_fp || state->record_iq_fp) {
        return 0;
    }
    if (make_activity_stamp(stamp, sizeof(stamp)) != 0) {
        fprintf(stderr, "Failed to create activity timestamp\n");
        return -1;
    }
    if (build_activity_segment_path(state->record_activity_prefix, stamp, "wav", &wav_path) != 0) {
        fprintf(stderr, "Failed to allocate activity WAV path\n");
        return -1;
    }
    if (build_activity_segment_path(state->record_activity_prefix, stamp, "cs8", &iq_path) != 0) {
        fprintf(stderr, "Failed to allocate activity IQ path\n");
        free(wav_path);
        return -1;
    }

    state->record_path = wav_path;
    state->recorded_audio_samples = 0;
    if (open_recording(state) != 0) {
        close_recording(state);
        free(iq_path);
        return -1;
    }

    state->record_iq_path = iq_path;
    state->recorded_iq_bytes = 0;
    if (open_iq_recording(state) != 0) {
        close_recording(state);
        close_iq_recording(state);
        return -1;
    }

    fprintf(stderr, "Recording activity WAV: %s\n", state->record_path);
    fprintf(stderr, "Recording activity IQ: %s\n", state->record_iq_path);
    fflush(stderr);
    return 0;
}

static void close_activity_recordings(stream_state_t* state, bool log_saved)
{
    char* wav_path = NULL;
    char* iq_path = NULL;
    bool log_segment_paths = log_saved && state->record_activity_prefix && *state->record_activity_prefix;
    bool had_wav = state->record_fp != NULL;
    bool had_iq = state->record_iq_fp != NULL;
    uint64_t wav_samples = state->recorded_audio_samples;
    uint64_t iq_bytes = state->recorded_iq_bytes;

    if (state->record_path) {
        wav_path = strdup(state->record_path);
    }
    if (state->record_iq_path) {
        iq_path = strdup(state->record_iq_path);
    }

    close_recording(state);
    close_iq_recording(state);

    if (log_segment_paths && had_wav && wav_path && wav_samples > 0) {
        fprintf(stderr, "Recording saved WAV: %s\n", wav_path);
    }
    if (log_segment_paths && had_iq && iq_path && iq_bytes > 0) {
        fprintf(stderr, "Recording saved IQ: %s\n", iq_path);
    }
    if (log_segment_paths && ((had_wav && wav_path && wav_samples > 0) || (had_iq && iq_path && iq_bytes > 0))) {
        fflush(stderr);
    }

    free(wav_path);
    free(iq_path);
    state->recorded_audio_samples = 0;
    state->recorded_iq_bytes = 0;
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

static int init_real_fir_decimator(
    real_fir_decimator_t* decimator,
    int length,
    int decim,
    double cutoff)
{
    memset(decimator, 0, sizeof(*decimator));
    decimator->length = length;
    decimator->decim = decim;
    decimator->taps = calloc((size_t) length, sizeof(double));
    decimator->hist = calloc((size_t) length, sizeof(double));
    if (!decimator->taps || !decimator->hist) {
        return -1;
    }
    return design_lowpass(decimator->taps, length, cutoff);
}

static void free_real_fir_decimator(real_fir_decimator_t* decimator)
{
    free(decimator->taps);
    free(decimator->hist);
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

static bool process_real_fir_decimator(
    real_fir_decimator_t* decimator,
    double input,
    double* output)
{
    int tap = 0;
    int idx = 0;

    decimator->hist[decimator->pos] = input;
    decimator->pos = (decimator->pos + 1) % decimator->length;

    decimator->phase++;
    if (decimator->phase < decimator->decim) {
        return false;
    }
    decimator->phase = 0;

    *output = 0.0;
    idx = decimator->pos - 1;
    if (idx < 0) {
        idx = decimator->length - 1;
    }

    for (tap = 0; tap < decimator->length; tap++) {
        *output += decimator->taps[tap] * decimator->hist[idx];
        idx--;
        if (idx < 0) {
            idx = decimator->length - 1;
        }
    }

    return true;
}

static int update_record_activity(stream_state_t* state, double analysis_sample)
{
    double rms = 0.0;

    if (!state->record_activity_prefix || !*state->record_activity_prefix) {
        return 0;
    }

    state->record_activity_window_sum_sq += analysis_sample * analysis_sample;
    state->record_activity_window_count++;

    if (state->record_activity_window_count >= state->record_activity_interval_samples) {
        rms = sqrt(state->record_activity_window_sum_sq / (double) state->record_activity_window_count);
        if (state->record_activity_warmup_windows > 0) {
            state->record_activity_warmup_windows--;
        } else if (rms >= state->record_activity_threshold) {
            state->record_activity_last_seen_sample = state->emitted_audio_samples;
            if (!state->record_fp && !state->record_iq_fp) {
                if (open_activity_recordings(state) != 0) {
                    return -1;
                }
            }
        }
        state->record_activity_window_count = 0;
        state->record_activity_window_sum_sq = 0.0;
    }

    if ((state->record_fp || state->record_iq_fp)
        && state->emitted_audio_samples >= state->record_activity_last_seen_sample
        && state->emitted_audio_samples - state->record_activity_last_seen_sample >= state->record_activity_hold_samples) {
        close_activity_recordings(state, true);
    }

    return 0;
}

static int emit_audio_sample(stream_state_t* state, double sample)
{
    double dc_alpha = 0.0008;
    double hp_alpha = 0.995;
    double agc_alpha = 0.0005;
    double agc_target = 9000.0;
    double input_sample = sample;
    double analysis_sample = 0.0;
    int16_t pcm = 0;

    state->dc_estimate += dc_alpha * (sample - state->dc_estimate);
    sample -= state->dc_estimate;

    if (state->mode == DEMOD_WFM) {
        state->deemph_y += state->deemph_alpha * (sample - state->deemph_y);
        sample = state->deemph_y;
        agc_target = 7000.0;
    } else if (state->mode == DEMOD_NFM) {
        agc_target = 10000.0;
    }

    input_sample = sample;
    sample = input_sample - state->hp_prev_x + hp_alpha * state->hp_prev_y;
    state->hp_prev_x = input_sample;
    state->hp_prev_y = sample;
    analysis_sample = sample;

    if (state->report_interval_samples > 0) {
        state->report_sum_sq += analysis_sample * analysis_sample;
        if (fabs(analysis_sample) > state->report_peak) {
            state->report_peak = fabs(analysis_sample);
        }
        state->report_count++;
        if (state->report_count >= state->report_interval_samples) {
            double rms = sqrt(state->report_sum_sq / (double) state->report_count);
            double rf_rms = state->report_rf_count > 0
                ? sqrt(state->report_rf_sum_sq / (double) state->report_rf_count)
                : 0.0;
            fprintf(stderr, "LEVEL rms=%.6f peak=%.6f rf=%.6f\n", rms, state->report_peak, rf_rms);
            fflush(stderr);
            state->report_count = 0;
            state->report_sum_sq = 0.0;
            state->report_peak = 0.0;
            state->report_rf_sum_sq = 0.0;
            state->report_rf_count = 0;
        }
    }

    if (update_record_activity(state, analysis_sample) != 0) {
        return -1;
    }

    state->agc_level += agc_alpha * (fabs(sample) - state->agc_level);
    if (state->agc_level < 1.0) {
        state->agc_level = 1.0;
    }

    sample *= (agc_target / state->agc_level) * state->audio_gain;
    pcm = (int16_t) clamp_pcm16(sample);

    if (!state->mute_audio) {
        if (fwrite(&pcm, sizeof(pcm), 1, stdout) != 1) {
            return -1;
        }
    }
    if (state->record_fp) {
        if (write_pcm16le(state->record_fp, pcm) != 0) {
            return -1;
        }
        state->recorded_audio_samples++;
    }

    state->emitted_audio_samples++;
    if (state->finite_duration && state->emitted_audio_samples >= state->duration_samples) {
        state->stop_requested = true;
    }

    return 0;
}

static void process_demod_audio(stream_state_t* state, double value)
{
    double audio_sample = 0.0;
    if (process_real_fir_decimator(&state->audio_decimator, value, &audio_sample)) {
        if (emit_audio_sample(state, audio_sample) != 0) {
            state->stop_requested = true;
        }
    }
}

static void process_iq_sample(stream_state_t* state, int8_t raw_i, int8_t raw_q)
{
    double mixed_i = 0.0;
    double mixed_q = 0.0;
    double filtered_i = 0.0;
    double filtered_q = 0.0;
    double demod = 0.0;
    double norm = 0.0;
    double next_cos = 0.0;
    double next_sin = 0.0;

    mixed_i = (double) raw_i * state->osc_cos - (double) raw_q * state->osc_sin;
    mixed_q = (double) raw_i * state->osc_sin + (double) raw_q * state->osc_cos;

    next_cos = state->osc_cos * state->osc_step_cos - state->osc_sin * state->osc_step_sin;
    next_sin = state->osc_sin * state->osc_step_cos + state->osc_cos * state->osc_step_sin;
    state->osc_cos = next_cos;
    state->osc_sin = next_sin;
    state->osc_renorm_counter++;
    if ((state->osc_renorm_counter & 4095U) == 0U) {
        double inv_mag = 1.0 / hypot(state->osc_cos, state->osc_sin);
        state->osc_cos *= inv_mag;
        state->osc_sin *= inv_mag;
    }

    if (!process_complex_fir_decimator(&state->rf_decimator, mixed_i, mixed_q, &filtered_i, &filtered_q)) {
        return;
    }

    if (state->report_interval_samples > 0) {
        state->report_rf_sum_sq += filtered_i * filtered_i + filtered_q * filtered_q;
        state->report_rf_count++;
    }

    if (state->mode == DEMOD_AM) {
        demod = hypot(filtered_i, filtered_q);
        process_demod_audio(state, demod);
        return;
    }

    norm = hypot(filtered_i, filtered_q);
    if (norm < 1e-9) {
        return;
    }
    filtered_i /= norm;
    filtered_q /= norm;

    if (!state->have_prev_iq) {
        state->prev_i = filtered_i;
        state->prev_q = filtered_q;
        state->have_prev_iq = true;
        return;
    }

    demod = atan2(
        state->prev_i * filtered_q - state->prev_q * filtered_i,
        state->prev_i * filtered_i + state->prev_q * filtered_q);

    state->prev_i = filtered_i;
    state->prev_q = filtered_q;

    process_demod_audio(state, demod);
}

static int rx_callback(hackrf_transfer* transfer)
{
    stream_state_t* state = (stream_state_t*) transfer->rx_ctx;
    int8_t* signed_buffer = (int8_t*) transfer->buffer;
    int index = 0;

    if (g_signal_stop || state->stop_requested) {
        return 1;
    }

    if (state->record_iq_fp && transfer->valid_length > 0) {
        size_t expected = (size_t) transfer->valid_length;
        size_t written = fwrite(transfer->buffer, 1, expected, state->record_iq_fp);
        if (written != expected) {
            fprintf(stderr, "Failed to write IQ data to %s\n", state->record_iq_path ? state->record_iq_path : "(iq)");
            state->stop_requested = true;
            return 1;
        }
        state->recorded_iq_bytes += (uint64_t) written;
    }

    for (index = 0; index + 1 < transfer->valid_length; index += 2) {
        process_iq_sample(state, signed_buffer[index], signed_buffer[index + 1]);
        if (g_signal_stop || state->stop_requested) {
            return 1;
        }
    }

    return 0;
}

static void cleanup_state(stream_state_t* state)
{
    close_activity_recordings(state, true);
    free(state->record_activity_prefix);
    state->record_activity_prefix = NULL;
    free_complex_fir_decimator(&state->rf_decimator);
    free_real_fir_decimator(&state->audio_decimator);
}

static int configure_mode(stream_state_t* state)
{
    double rf_cutoff = 0.0;
    double audio_cutoff = 0.0;
    int rf_taps = 0;
    int audio_taps = 63;

    if (state->sample_rate == 0) {
        state->sample_rate = 2000000;
    }
    if (state->audio_rate == 0) {
        state->audio_rate = 50000;
    }

    switch (state->mode) {
    case DEMOD_WFM:
        state->rf_rate = 250000;
        state->tune_offset_hz = 250000;
        state->rf_cutoff_hz = 100000;
        state->audio_cutoff_hz = 15000;
        rf_taps = 65;
        {
            double tau = 75e-6;
            double dt = 1.0 / (double) state->audio_rate;
            state->deemph_alpha = dt / (tau + dt);
        }
        break;
    case DEMOD_NFM:
        state->rf_rate = 100000;
        state->tune_offset_hz = 25000;
        state->rf_cutoff_hz = 12500;
        state->audio_cutoff_hz = 4500;
        rf_taps = 129;
        break;
    case DEMOD_AM:
    default:
        state->rf_rate = 100000;
        state->tune_offset_hz = 25000;
        state->rf_cutoff_hz = 8000;
        state->audio_cutoff_hz = 4500;
        rf_taps = 129;
        break;
    }

    if (state->sample_rate % state->rf_rate != 0) {
        fprintf(stderr, "sample_rate=%u must be divisible by rf_rate=%u\n", state->sample_rate, state->rf_rate);
        return -1;
    }
    if (state->rf_rate % state->audio_rate != 0) {
        fprintf(stderr, "rf_rate=%u must be divisible by audio_rate=%u\n", state->rf_rate, state->audio_rate);
        return -1;
    }
    if ((state->sample_rate / 2U) <= state->tune_offset_hz) {
        fprintf(stderr, "sample_rate=%u too low for offset tuning of %llu Hz\n",
            state->sample_rate,
            (unsigned long long) state->tune_offset_hz);
        return -1;
    }

    state->tuned_freq_hz = state->freq_hz + state->tune_offset_hz;
    rf_cutoff = (double) state->rf_cutoff_hz / (double) state->sample_rate;
    audio_cutoff = (double) state->audio_cutoff_hz / (double) state->rf_rate;

    if (init_complex_fir_decimator(
            &state->rf_decimator,
            rf_taps,
            (int) (state->sample_rate / state->rf_rate),
            rf_cutoff)
        != 0) {
        fprintf(stderr, "Failed to initialize RF decimator\n");
        return -1;
    }

    if (init_real_fir_decimator(
            &state->audio_decimator,
            audio_taps,
            (int) (state->rf_rate / state->audio_rate),
            audio_cutoff)
        != 0) {
        fprintf(stderr, "Failed to initialize audio decimator\n");
        free_complex_fir_decimator(&state->rf_decimator);
        return -1;
    }

    {
        double step = 2.0 * M_PI * ((double) state->tune_offset_hz / (double) state->sample_rate);
        state->osc_cos = 1.0;
        state->osc_sin = 0.0;
        state->osc_step_cos = cos(step);
        state->osc_step_sin = sin(step);
    }

    if (state->finite_duration) {
        state->duration_samples = (uint64_t) llround(state->duration_seconds * (double) state->audio_rate);
    }

    if (state->record_activity_prefix && *state->record_activity_prefix) {
        state->record_activity_threshold = default_activity_threshold(state->mode);
        state->record_activity_interval_samples = (uint64_t) llround((double) state->audio_rate * 0.20);
        if (state->record_activity_interval_samples == 0) {
            state->record_activity_interval_samples = 1;
        }
        state->record_activity_hold_samples = (uint64_t) llround((double) state->audio_rate * 2.5);
        if (state->record_activity_hold_samples == 0) {
            state->record_activity_hold_samples = state->record_activity_interval_samples;
        }
        state->record_activity_warmup_windows = 1;
    }

    return 0;
}

int main(int argc, char** argv)
{
    stream_state_t state;
    int result = HACKRF_SUCCESS;
    uint32_t bandwidth = 0;
    int opt = 0;
    double seconds = 0.0;

    memset(&state, 0, sizeof(state));
    state.mode = DEMOD_AM;
    state.sample_rate = 2000000;
    state.audio_rate = 50000;
    state.lna_gain = 24;
    state.vga_gain = 20;
    state.audio_gain = 1.0;
    state.agc_level = 1.0;

    while ((opt = getopt(argc, argv, "f:m:l:g:G:r:a:t:R:o:q:P:Qh")) != -1) {
        switch (opt) {
        case 'f':
            if (parse_u64(optarg, &state.freq_hz) != 0) {
                fprintf(stderr, "Invalid frequency: %s\n", optarg);
                return 1;
            }
            break;
        case 'm':
            if (parse_mode(optarg, &state.mode) != 0) {
                fprintf(stderr, "Invalid mode: %s\n", optarg);
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
        case 'G':
            if (parse_double_value(optarg, &state.audio_gain) != 0) {
                fprintf(stderr, "Invalid audio gain: %s\n", optarg);
                return 1;
            }
            break;
        case 'r':
            if (parse_u32(optarg, &state.sample_rate) != 0) {
                fprintf(stderr, "Invalid sample rate: %s\n", optarg);
                return 1;
            }
            break;
        case 'a':
            if (parse_u32(optarg, &state.audio_rate) != 0) {
                fprintf(stderr, "Invalid audio rate: %s\n", optarg);
                return 1;
            }
            break;
        case 't':
            if (parse_double_value(optarg, &seconds) != 0 || seconds <= 0.0) {
                fprintf(stderr, "Invalid duration: %s\n", optarg);
                return 1;
            }
            state.finite_duration = true;
            state.duration_seconds = seconds;
            break;
        case 'R':
            if (parse_u32(optarg, &state.report_interval_ms) != 0 || state.report_interval_ms == 0) {
                fprintf(stderr, "Invalid report interval: %s\n", optarg);
                return 1;
            }
            break;
        case 'o':
            free(state.record_path);
            state.record_path = strdup(optarg);
            if (!state.record_path || !*state.record_path) {
                fprintf(stderr, "Invalid recording path: %s\n", optarg);
                return 1;
            }
            break;
        case 'q':
            free(state.record_iq_path);
            state.record_iq_path = strdup(optarg);
            if (!state.record_iq_path || !*state.record_iq_path) {
                fprintf(stderr, "Invalid IQ recording path: %s\n", optarg);
                return 1;
            }
            break;
        case 'P':
            free(state.record_activity_prefix);
            state.record_activity_prefix = strdup(optarg);
            if (!state.record_activity_prefix || !*state.record_activity_prefix) {
                fprintf(stderr, "Invalid activity recording prefix: %s\n", optarg);
                return 1;
            }
            break;
        case 'Q':
            state.mute_audio = true;
            break;
        case 'h':
        default:
            usage(argv[0]);
            return opt == 'h' ? 0 : 1;
        }
    }

    if (state.freq_hz == 0) {
        usage(argv[0]);
        return 1;
    }

    if (state.record_activity_prefix && ((state.record_path && *state.record_path) || (state.record_iq_path && *state.record_iq_path))) {
        fprintf(stderr, "Choose either fixed recording paths (-o/-q) or activity recording (-P), not both.\n");
        cleanup_state(&state);
        return 1;
    }

    if (configure_mode(&state) != 0) {
        cleanup_state(&state);
        return 1;
    }

    if (state.report_interval_ms > 0) {
        state.report_interval_samples =
            (uint64_t) llround(((double) state.audio_rate * (double) state.report_interval_ms) / 1000.0);
        if (state.report_interval_samples == 0) {
            state.report_interval_samples = 1;
        }
    }

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

    result = hackrf_set_freq(state.device, state.tuned_freq_hz);
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
    if (!state.record_activity_prefix) {
        if (open_recording(&state) != 0) {
            result = HACKRF_ERROR_OTHER;
            goto cleanup;
        }
        if (open_iq_recording(&state) != 0) {
            result = HACKRF_ERROR_OTHER;
            goto cleanup;
        }
    }

    fprintf(stderr,
        "Listening: target=%0.6f MHz tuned=%0.6f MHz mode=%s rf_rate=%u audio_rate=%u lna=%u vga=%u\n",
        state.freq_hz / 1e6,
        state.tuned_freq_hz / 1e6,
        mode_name(state.mode),
        state.rf_rate,
        state.audio_rate,
        state.lna_gain,
        state.vga_gain);
    fflush(stderr);
    if (state.record_path) {
        fprintf(stderr, "Recording: %s\n", state.record_path);
        fflush(stderr);
    }
    if (state.record_iq_path) {
        fprintf(stderr, "Recording IQ: %s\n", state.record_iq_path);
        fflush(stderr);
    }
    if (state.record_activity_prefix) {
        fprintf(
            stderr,
            "Recording on activity: %s_*  threshold=%.4f  hold=%.1fs\n",
            state.record_activity_prefix,
            state.record_activity_threshold,
            (double) state.record_activity_hold_samples / (double) state.audio_rate);
        fflush(stderr);
    }

    result = hackrf_start_rx(state.device, rx_callback, &state);
    if (result != HACKRF_SUCCESS) {
        fprintf(stderr, "hackrf_start_rx() failed: %s\n", hackrf_error_name(result));
        goto cleanup;
    }

    while (!g_signal_stop && !state.stop_requested && hackrf_is_streaming(state.device) == HACKRF_TRUE) {
        struct timespec sleep_time = {0, 100000000};
        nanosleep(&sleep_time, NULL);
    }

    hackrf_stop_rx(state.device);
    fflush(stdout);

cleanup:
    if (state.device) {
        hackrf_close(state.device);
    }
    hackrf_exit();
    cleanup_state(&state);
    return 0;
}
