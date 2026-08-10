import assert from "node:assert/strict";
import test from "node:test";

import { parseHackrfInfoOutput } from "@/server/hackrf-info";

test("parseHackrfInfoOutput preserves firmware values containing colons", () => {
  const parsed = parseHackrfInfoOutput(`
Board ID Number: 2 (HackRF One)
Firmware Version: v2.1.0 (API:1.08)
Part ID Number: 0xa000cb3c 0x00584769
Hardware Revision: r10
Serial number: 0000000000000000436c63dc2f5c6f63
`);

  assert.equal(parsed.board, "2 (HackRF One)");
  assert.equal(parsed.firmware, "v2.1.0 (API:1.08)");
  assert.equal(parsed.hardware, "r10");
  assert.equal(parsed.serial, "0000000000000000436c63dc2f5c6f63");
});
