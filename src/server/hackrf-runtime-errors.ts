const HACKRF_NOT_FOUND_PATTERNS = [
  /\bno hackrf boards found\b/i,
  /\bhackrf_open(?:\(\))?\s*failed:\s*hackrf not found\b/i,
  /\bhackrf_open(?:\(\))?\s*failed\s+with\s+code\s+-5\b/i,
  /\bhackrf not found\b/i,
];

const HACKRF_BUSY_PATTERNS = [
  /\bhackrf_open(?:\(\))?\s*failed\s+with\s+code\s+-6\b/i,
  /\bdevice or resource busy\b/i,
  /\bresource busy\b/i,
  /\busb_claim_interface\b.*\b-6\b/i,
];

function matchesAnyPattern(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function normalizeHackrfRuntimeErrorMessage(message: string): string {
  const normalized = message.trim();
  if (!normalized) {
    return normalized;
  }

  if (matchesAnyPattern(normalized, HACKRF_NOT_FOUND_PATTERNS)) {
    return "HackRF not found. Connect the device over USB and try again.";
  }

  if (matchesAnyPattern(normalized, HACKRF_BUSY_PATTERNS)) {
    return "HackRF is busy. Stop the active stream or decoder and try again.";
  }

  return normalized;
}

export function pickHackrfRuntimeErrorMessage(
  lines: string[],
  fallbackMessage: string,
): string {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) {
      continue;
    }

    const normalized = normalizeHackrfRuntimeErrorMessage(line);
    if (normalized !== line || normalized) {
      return normalized;
    }
  }

  return normalizeHackrfRuntimeErrorMessage(fallbackMessage);
}
