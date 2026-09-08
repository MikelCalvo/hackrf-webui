import assert from "node:assert/strict";
import test from "node:test";

import { AsyncSerial } from "@/server/async-serial";

test("AsyncSerial does not begin a replacement operation before teardown settles", async () => {
  const serial = new AsyncSerial();
  const events: string[] = [];
  let releaseTeardown: (() => void) | undefined;
  const teardown = new Promise<void>((resolve) => {
    releaseTeardown = resolve;
  });

  const first = serial.run(async () => {
    events.push("stop:start");
    await teardown;
    events.push("stop:done");
  });
  const second = serial.run(async () => {
    events.push("start");
  });

  await Promise.resolve();
  assert.deepEqual(events, ["stop:start"]);

  releaseTeardown?.();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["stop:start", "stop:done", "start"]);
});

test("AsyncSerial continues with a later operation after a failure", async () => {
  const serial = new AsyncSerial();
  const failure = serial.run(async () => {
    throw new Error("expected failure");
  });
  const afterFailure = serial.run(async () => "usable");

  await assert.rejects(failure, /expected failure/);
  assert.equal(await afterFailure, "usable");
});
