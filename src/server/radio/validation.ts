import type {
  CreateAdsbSessionRequest,
  CreateAisSessionRequest,
  CreateFmSessionRequest,
  CreateNarrowbandSessionRequest,
  CreateRadioSessionRequest,
  NarrowbandScanMode,
  RadioSessionChannel,
  RadioSessionFmStation,
  RadioSessionModule,
  UpdateFmSessionRequest,
  UpdateNarrowbandSessionRequest,
  UpdateRadioSessionRequest,
} from "@/lib/radio-session";
import type { AudioControls } from "@/lib/radio";
import type { ResolvedAppLocation } from "@/lib/types";
import { SCANNER_POST_HIT_HOLD_MAX_SECONDS } from "@/lib/signal-activity";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; status?: number };

export const MAX_RADIO_SESSION_PAYLOAD_BYTES = 128 * 1024;
export const MAX_NARROWBAND_CHANNELS = 512;

const MAX_ID_LENGTH = 128;
const MAX_LABEL_LENGTH = 160;
const MAX_NOTES_LENGTH = 512;
const MAX_LOCATION_BYTES = 8 * 1024;

const MODULE_FREQUENCY_LIMITS = {
  fm: { min: 64, max: 108, label: "FM" },
  pmr: { min: 150, max: 480, label: "PMR" },
  airband: { min: 118, max: 137, label: "airband" },
  maritime: { min: 156, max: 162.55, label: "maritime" },
} as const;

type NarrowbandModule = Extract<RadioSessionModule, "pmr" | "airband" | "maritime">;

type ValidationContext = {
  module?: Extract<RadioSessionModule, "fm" | NarrowbandModule>;
};

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function invalid<T = never>(message: string, status = 400): ValidationResult<T> {
  return { ok: false, message, status };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateString(
  value: unknown,
  field: string,
  {
    maxLength = MAX_ID_LENGTH,
    allowEmpty = false,
  }: { maxLength?: number; allowEmpty?: boolean } = {},
): ValidationResult<string> {
  if (typeof value !== "string") {
    return invalid(`${field} must be a string.`);
  }

  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    return invalid(`${field} is required.`);
  }
  if (trimmed.length > maxLength) {
    return invalid(`${field} must be ${maxLength} characters or less.`);
  }

  return ok(trimmed);
}

function validateOptionalString(
  value: unknown,
  field: string,
  maxLength = MAX_NOTES_LENGTH,
): ValidationResult<string | undefined> {
  if (value === undefined || value === null) {
    return ok(undefined);
  }
  const result = validateString(value, field, { maxLength, allowEmpty: true });
  if (!result.ok) {
    return result;
  }
  return ok(result.value.length > 0 ? result.value : undefined);
}

function validateFiniteNumber(
  value: unknown,
  field: string,
  min: number,
  max: number,
): ValidationResult<number> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return invalid(`${field} must be a finite number.`);
  }
  if (value < min || value > max) {
    return invalid(`${field} must be between ${min} and ${max}.`);
  }
  return ok(value);
}

function validateInteger(
  value: unknown,
  field: string,
  min: number,
  max: number,
): ValidationResult<number> {
  const number = validateFiniteNumber(value, field, min, max);
  if (!number.ok) {
    return number;
  }
  if (!Number.isInteger(number.value)) {
    return invalid(`${field} must be an integer.`);
  }
  return number;
}

function validateControls(value: unknown): ValidationResult<AudioControls> {
  if (!isRecord(value)) {
    return invalid("controls must be an object.");
  }

  const lna = validateInteger(value.lna, "controls.lna", 0, 40);
  if (!lna.ok) {
    return lna;
  }
  const vga = validateInteger(value.vga, "controls.vga", 0, 62);
  if (!vga.ok) {
    return vga;
  }
  const audioGain = validateFiniteNumber(value.audioGain, "controls.audioGain", 0.01, 8);
  if (!audioGain.ok) {
    return audioGain;
  }

  return ok({
    lna: lna.value,
    vga: vga.value,
    audioGain: audioGain.value,
  });
}

function validateFrequency(
  value: unknown,
  module: keyof typeof MODULE_FREQUENCY_LIMITS,
  field: string,
): ValidationResult<number> {
  const limits = MODULE_FREQUENCY_LIMITS[module];
  const frequency = validateFiniteNumber(value, field, limits.min, limits.max);
  if (!frequency.ok) {
    return invalid(`${field} frequency must be inside the ${limits.label} range (${limits.min}-${limits.max} MHz).`);
  }
  return frequency;
}

function validateStation(value: unknown): ValidationResult<RadioSessionFmStation> {
  if (!isRecord(value)) {
    return invalid("station must be an object.");
  }

  const id = validateString(value.id, "station.id", { maxLength: MAX_ID_LENGTH });
  if (!id.ok) {
    return id;
  }
  const name = validateString(value.name, "station.name", { maxLength: MAX_LABEL_LENGTH });
  if (!name.ok) {
    return name;
  }
  const freqMhz = validateFrequency(value.freqMhz, "fm", "station.freqMhz");
  if (!freqMhz.ok) {
    return freqMhz;
  }

  return ok({ id: id.value, name: name.value, freqMhz: freqMhz.value });
}

function validateChannel(
  value: unknown,
  index: number,
  module?: NarrowbandModule,
): ValidationResult<RadioSessionChannel> {
  if (!isRecord(value)) {
    return invalid(`channels[${index}] must be an object.`);
  }

  const id = validateString(value.id, `channels[${index}].id`, { maxLength: MAX_ID_LENGTH });
  if (!id.ok) {
    return id;
  }
  const bandId = validateString(value.bandId, `channels[${index}].bandId`, { maxLength: MAX_ID_LENGTH });
  if (!bandId.ok) {
    return bandId;
  }
  const number = validateInteger(value.number, `channels[${index}].number`, 0, 10_000);
  if (!number.ok) {
    return number;
  }
  const label = validateString(value.label, `channels[${index}].label`, { maxLength: MAX_LABEL_LENGTH });
  if (!label.ok) {
    return label;
  }
  const notes = validateOptionalString(value.notes, `channels[${index}].notes`, MAX_NOTES_LENGTH);
  if (!notes.ok) {
    return notes;
  }

  const freqMhz = module
    ? validateFrequency(value.freqMhz, module, `channels[${index}].freqMhz`)
    : validateFiniteNumber(value.freqMhz, `channels[${index}].freqMhz`, 64, 600);
  if (!freqMhz.ok) {
    return freqMhz;
  }

  return ok({
    id: id.value,
    bandId: bandId.value,
    number: number.value,
    freqMhz: freqMhz.value,
    label: label.value,
    ...(notes.value ? { notes: notes.value } : {}),
  });
}

function validateChannels(value: unknown, module?: NarrowbandModule): ValidationResult<RadioSessionChannel[]> {
  if (!Array.isArray(value) || value.length === 0) {
    return invalid("A non-empty channel deck is required.");
  }
  if (value.length > MAX_NARROWBAND_CHANNELS) {
    return invalid(`Channel deck is limited to ${MAX_NARROWBAND_CHANNELS} entries.`);
  }

  const channels: RadioSessionChannel[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const channel = validateChannel(value[index], index, module);
    if (!channel.ok) {
      return channel;
    }
    if (ids.has(channel.value.id)) {
      return invalid(`Duplicate channel id in deck: ${channel.value.id}.`);
    }
    ids.add(channel.value.id);
    channels.push(channel.value);
  }

  return ok(channels);
}

function validateScanMode(value: unknown): ValidationResult<NarrowbandScanMode | undefined> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (value !== "sequential" && value !== "random") {
    return invalid("Invalid narrowband scan mode.");
  }
  return ok(value);
}

function validateLocation(value: unknown): ValidationResult<ResolvedAppLocation | null | undefined> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (value === null) {
    return ok(null);
  }
  if (!isRecord(value)) {
    return invalid("location must be an object or null.");
  }

  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_LOCATION_BYTES) {
    return invalid(`location must be ${MAX_LOCATION_BYTES} bytes or less.`);
  }

  const position = isRecord(value.resolvedPosition) ? value.resolvedPosition : null;
  if (position) {
    const latitude = validateFiniteNumber(position.latitude, "location.resolvedPosition.latitude", -90, 90);
    if (!latitude.ok) {
      return latitude;
    }
    const longitude = validateFiniteNumber(position.longitude, "location.resolvedPosition.longitude", -180, 180);
    if (!longitude.ok) {
      return longitude;
    }
  }

  return ok(value as ResolvedAppLocation);
}

function validateNarrowbandCreate(
  payload: Record<string, unknown>,
  module: NarrowbandModule,
): ValidationResult<CreateNarrowbandSessionRequest> {
  const mode = payload.mode === "manual" || payload.mode === "scan"
    ? payload.mode
    : null;
  if (!mode) {
    return invalid("Invalid narrowband session mode.");
  }

  const controls = validateControls(payload.controls);
  if (!controls.ok) {
    return controls;
  }
  const bandId = validateString(payload.bandId, "bandId", { maxLength: MAX_ID_LENGTH });
  if (!bandId.ok) {
    return bandId;
  }
  const channels = validateChannels(payload.channels, module);
  if (!channels.ok) {
    return channels;
  }
  const scanMode = validateScanMode(payload.scanMode);
  if (!scanMode.ok) {
    return scanMode;
  }
  const manualChannelId = validateOptionalString(payload.manualChannelId, "manualChannelId", MAX_ID_LENGTH);
  if (!manualChannelId.ok) {
    return manualChannelId;
  }
  if (manualChannelId.value && !channels.value.some((channel) => channel.id === manualChannelId.value)) {
    return invalid("manualChannelId must reference a channel in the deck.");
  }
  const squelch = validateFiniteNumber(payload.squelch, "squelch", 0, 1);
  if (!squelch.ok) {
    return squelch;
  }
  const dwellTime = validateInteger(payload.dwellTime, "dwellTime", 1, 60);
  if (!dwellTime.ok) {
    return dwellTime;
  }
  const holdTime = validateInteger(payload.holdTime, "holdTime", 0, SCANNER_POST_HIT_HOLD_MAX_SECONDS);
  if (!holdTime.ok) {
    return holdTime;
  }
  const location = validateLocation(payload.location);
  if (!location.ok) {
    return location;
  }

  return ok({
    kind: "narrowband",
    module,
    mode,
    controls: controls.value,
    bandId: bandId.value,
    channels: channels.value,
    ...(scanMode.value ? { scanMode: scanMode.value } : {}),
    ...(manualChannelId.value !== undefined ? { manualChannelId: manualChannelId.value } : {}),
    squelch: squelch.value,
    dwellTime: dwellTime.value,
    holdTime: holdTime.value,
    ...(location.value !== undefined ? { location: location.value } : {}),
  });
}

export function validateCreateRadioSessionRequest(value: unknown): ValidationResult<CreateRadioSessionRequest> {
  if (!isRecord(value)) {
    return invalid("Request payload must be an object.");
  }

  if (value.kind === "fm" && value.module === "fm") {
    const controls = validateControls(value.controls);
    if (!controls.ok) {
      return controls;
    }
    const station = validateStation(value.station);
    if (!station.ok) {
      return station;
    }
    return ok<CreateFmSessionRequest>({
      kind: "fm",
      module: "fm",
      controls: controls.value,
      station: station.value,
    });
  }

  if (value.kind === "ais" && value.module === "ais") {
    return ok<CreateAisSessionRequest>({ kind: "ais", module: "ais" });
  }

  if (value.kind === "adsb" && value.module === "adsb") {
    return ok<CreateAdsbSessionRequest>({ kind: "adsb", module: "adsb" });
  }

  if (value.kind === "narrowband") {
    if (value.module === "pmr" || value.module === "airband" || value.module === "maritime") {
      return validateNarrowbandCreate(value, value.module);
    }
  }

  return invalid("Unsupported radio session kind.");
}

export function validateUpdateRadioSessionRequest(
  value: unknown,
  context: ValidationContext = {},
): ValidationResult<UpdateRadioSessionRequest> {
  if (!isRecord(value)) {
    return invalid("Request payload must be an object.");
  }

  const patch: Partial<UpdateFmSessionRequest & UpdateNarrowbandSessionRequest> = {};
  const sessionModule = context.module;

  if (value.controls !== undefined) {
    const controls = validateControls(value.controls);
    if (!controls.ok) {
      return controls;
    }
    patch.controls = controls.value;
  }

  if (value.station !== undefined) {
    if (sessionModule && sessionModule !== "fm") {
      return invalid("station can only be updated on FM sessions.");
    }
    const station = validateStation(value.station);
    if (!station.ok) {
      return station;
    }
    patch.station = station.value;
  }

  if (value.mode !== undefined) {
    if (value.mode !== "manual" && value.mode !== "scan") {
      return invalid("Invalid narrowband session mode.");
    }
    patch.mode = value.mode;
  }

  if (value.bandId !== undefined) {
    const bandId = validateString(value.bandId, "bandId", { maxLength: MAX_ID_LENGTH });
    if (!bandId.ok) {
      return bandId;
    }
    patch.bandId = bandId.value;
  }

  if (value.channels !== undefined) {
    const channelModule = sessionModule === "pmr" || sessionModule === "airband" || sessionModule === "maritime" ? sessionModule : undefined;
    const channels = validateChannels(value.channels, channelModule);
    if (!channels.ok) {
      return channels;
    }
    patch.channels = channels.value;
  }

  if (value.scanMode !== undefined) {
    const scanMode = validateScanMode(value.scanMode);
    if (!scanMode.ok || !scanMode.value) {
      return scanMode.ok ? invalid("Invalid narrowband scan mode.") : scanMode;
    }
    patch.scanMode = scanMode.value;
  }

  if (value.manualChannelId !== undefined) {
    const manualChannelId = validateOptionalString(value.manualChannelId, "manualChannelId", MAX_ID_LENGTH);
    if (!manualChannelId.ok) {
      return manualChannelId;
    }
    patch.manualChannelId = manualChannelId.value ?? null;
  }

  if (value.squelch !== undefined) {
    const squelch = validateFiniteNumber(value.squelch, "squelch", 0, 1);
    if (!squelch.ok) {
      return squelch;
    }
    patch.squelch = squelch.value;
  }

  if (value.dwellTime !== undefined) {
    const dwellTime = validateInteger(value.dwellTime, "dwellTime", 1, 60);
    if (!dwellTime.ok) {
      return dwellTime;
    }
    patch.dwellTime = dwellTime.value;
  }

  if (value.holdTime !== undefined) {
    const holdTime = validateInteger(value.holdTime, "holdTime", 0, SCANNER_POST_HIT_HOLD_MAX_SECONDS);
    if (!holdTime.ok) {
      return holdTime;
    }
    patch.holdTime = holdTime.value;
  }

  if (value.location !== undefined) {
    const location = validateLocation(value.location);
    if (!location.ok) {
      return location;
    }
    patch.location = location.value ?? null;
  }

  return ok(patch as UpdateRadioSessionRequest);
}
