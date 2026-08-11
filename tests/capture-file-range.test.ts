import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCaptureFileResponse, buildCaptureFileStreamResponse } from "@/server/capture-file-response";

test("capture file responses advertise length and byte ranges", async () => {
  const payload = Buffer.from("0123456789");
  const response = buildCaptureFileResponse(new Request("http://local/capture"), payload, {
    contentType: "audio/wav",
    disposition: 'inline; filename="capture.wav"',
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-length"), "10");
  assert.equal(Buffer.from(await response.arrayBuffer()).toString(), "0123456789");
});

test("capture file responses serve valid ranges and reject invalid ones", async () => {
  const payload = Buffer.from("0123456789");
  const partial = buildCaptureFileResponse(
    new Request("http://local/capture", { headers: { Range: "bytes=2-5" } }),
    payload,
    { contentType: "audio/wav", disposition: 'inline; filename="capture.wav"' },
  );
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(partial.headers.get("content-length"), "4");
  assert.equal(Buffer.from(await partial.arrayBuffer()).toString(), "2345");

  const suffix = buildCaptureFileResponse(
    new Request("http://local/capture", { headers: { Range: "bytes=-3" } }),
    payload,
    { contentType: "audio/wav", disposition: 'inline; filename="capture.wav"' },
  );
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers.get("content-range"), "bytes 7-9/10");
  assert.equal(Buffer.from(await suffix.arrayBuffer()).toString(), "789");

  const invalid = buildCaptureFileResponse(
    new Request("http://local/capture", { headers: { Range: "bytes=20-30" } }),
    payload,
    { contentType: "audio/wav", disposition: 'inline; filename="capture.wav"' },
  );
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("content-range"), "bytes */10");
});

test("capture file stream responses preserve range behavior without buffering the file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "hackrf-range-"));
  const filePath = path.join(directory, "capture.wav");
  await writeFile(filePath, "0123456789");
  try {
    const response = buildCaptureFileStreamResponse(
      new Request("http://local/capture", { headers: { Range: "bytes=3-6" } }),
      filePath,
      { contentType: "audio/wav", disposition: 'inline; filename="capture.wav"' },
    );
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), "bytes 3-6/10");
    assert.equal(response.headers.get("content-length"), "4");
    assert.equal(await response.text(), "3456");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
