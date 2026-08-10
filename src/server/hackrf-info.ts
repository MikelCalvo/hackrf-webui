export function parseHackrfInfoOutput(output: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const separator = line.indexOf(":");
    const value = separator >= 0 ? line.slice(separator + 1).trim() : "";

    if (line.startsWith("Board ID Number:")) {
      parsed.board = value;
    } else if (line.startsWith("Firmware Version:")) {
      parsed.firmware = value;
    } else if (line.startsWith("Hardware Revision:")) {
      parsed.hardware = value;
    } else if (line.startsWith("Serial number:")) {
      parsed.serial = value;
    }
  }

  return parsed;
}
