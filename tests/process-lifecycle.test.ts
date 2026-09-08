import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { terminateChildProcess } from "@/server/process-lifecycle";

class FakeChildProcess extends EventEmitter {
  exitCode: number | null = null;

  signalCode: NodeJS.Signals | null = null;

  readonly signals: string[] = [];

  constructor(private readonly ignoreTerminate: boolean) {
    super();
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    const signalName = typeof signal === "string" ? signal : "SIGTERM";
    this.signals.push(signalName);
    if (signalName === "SIGKILL" || !this.ignoreTerminate) {
      this.exitCode = signalName === "SIGKILL" ? 137 : 0;
      this.emit("close", this.exitCode, signalName);
    }
    return true;
  }
}

test("terminateChildProcess resolves from exit even when descendant stdio delays close", async () => {
  const child = new FakeChildProcess(true);
  child.kill = (signal?: NodeJS.Signals | number) => {
    const signalName = typeof signal === "string" ? signal : "SIGTERM";
    child.signals.push(signalName);
    if (signalName === "SIGKILL") {
      child.signalCode = "SIGKILL";
      child.emit("exit", null, signalName);
    }
    return true;
  };

  await Promise.race([
    terminateChildProcess(child, 1),
    new Promise((_, reject) => setTimeout(() => reject(new Error("exit did not settle teardown")), 50)),
  ]);

  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("terminateChildProcess escalates when SIGTERM does not close the child", async () => {
  const child = new FakeChildProcess(true);

  await terminateChildProcess(child, 1);

  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.exitCode, 137);
});

test("terminateChildProcess completes without SIGKILL when SIGTERM closes the child", async () => {
  const child = new FakeChildProcess(false);

  await terminateChildProcess(child, 10);

  assert.deepEqual(child.signals, ["SIGTERM"]);
  assert.equal(child.exitCode, 0);
});

test("terminateChildProcess skips a child already closed by signal", async () => {
  const child = new FakeChildProcess(true);
  child.signalCode = "SIGTERM";

  await terminateChildProcess(child, 10);

  assert.deepEqual(child.signals, []);
});

test("terminateChildProcess escalates immediately when SIGTERM cannot be sent", async () => {
  const child = new FakeChildProcess(true);
  child.kill = (signal?: NodeJS.Signals | number) => {
    const signalName = typeof signal === "string" ? signal : "SIGTERM";
    child.signals.push(signalName);
    if (signalName === "SIGKILL") {
      child.exitCode = 137;
      child.emit("close", 137, signalName);
      return true;
    }
    return false;
  };

  await terminateChildProcess(child, 1000);

  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.exitCode, 137);
});

test("terminateChildProcess does not hang if neither signal can be sent", async () => {
  const child = new FakeChildProcess(true);
  child.kill = (signal?: NodeJS.Signals | number) => {
    child.signals.push(typeof signal === "string" ? signal : "SIGTERM");
    return false;
  };

  await terminateChildProcess(child, 1000);

  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});
