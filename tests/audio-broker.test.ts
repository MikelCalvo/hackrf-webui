import assert from "node:assert/strict";
import test from "node:test";

import { AudioBroker } from "@/server/radio/audio-broker";

test("AudioBroker bounds a non-reading subscriber queue", async () => {
  const broker = new AudioBroker();
  const reader = broker.createStream().getReader();

  for (let value = 0; value < 10; value += 1) {
    broker.broadcast(Uint8Array.of(value));
  }
  broker.close();

  const received: number[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received.push(value[0]);
  }

  assert.deepEqual(received, [0, 1, 2, 3]);
});

test("AudioBroker resumes delivery after a subscriber drains capacity", async () => {
  const broker = new AudioBroker();
  const reader = broker.createStream().getReader();

  for (let value = 0; value < 5; value += 1) {
    broker.broadcast(Uint8Array.of(value));
  }
  assert.equal((await reader.read()).value?.[0], 0);

  broker.broadcast(Uint8Array.of(5));
  broker.close();

  const received: number[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received.push(value[0]);
  }

  assert.deepEqual(received, [1, 2, 3, 5]);
});
