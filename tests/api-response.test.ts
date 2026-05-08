import test from "node:test";
import assert from "node:assert/strict";

import {
  isPayloadTooLarge,
  jsonMessage,
  readJsonPayload,
} from "@/server/api/response";

test("jsonMessage returns a no-store JSON response", async () => {
  const response = jsonMessage("Nope", 418);

  assert.equal(response.status, 418);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { message: "Nope" });
});

test("isPayloadTooLarge only rejects finite content lengths above the limit", () => {
  assert.equal(isPayloadTooLarge(new Request("http://local", { headers: { "content-length": "11" } }), 10), true);
  assert.equal(isPayloadTooLarge(new Request("http://local", { headers: { "content-length": "10" } }), 10), false);
  assert.equal(isPayloadTooLarge(new Request("http://local", { headers: { "content-length": "NaN" } }), 10), false);
  assert.equal(isPayloadTooLarge(new Request("http://local"), 10), false);
});

test("readJsonPayload handles oversize and invalid JSON consistently", async () => {
  const oversized = await readJsonPayload(
    new Request("http://local", { method: "POST", headers: { "content-length": "11" }, body: "{}" }),
    10,
  );
  assert.equal(oversized.ok, false);
  if (!oversized.ok) {
    assert.equal(oversized.response.status, 413);
  }

  const invalid = await readJsonPayload(
    new Request("http://local", { method: "POST", body: "not json" }),
    100,
  );
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.response.status, 400);
  }

  const valid = await readJsonPayload(
    new Request("http://local", { method: "POST", body: JSON.stringify({ ok: true }) }),
    100,
  );
  assert.deepEqual(valid, { ok: true, value: { ok: true } });
});
