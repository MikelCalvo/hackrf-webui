type TerminableChildProcess = {
  exitCode: number | null;
  signalCode: NodeJS.Signals | number | null;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  once: (event: "close" | "exit", listener: () => void) => unknown;
};

function hasExited(processRef: TerminableChildProcess): boolean {
  return processRef.exitCode !== null || processRef.signalCode !== null;
}

export function terminateChildProcess(processRef: TerminableChildProcess, graceMs: number): Promise<void> {
  if (hasExited(processRef)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    let escalationTimer: ReturnType<typeof setTimeout> | null = null;
    let completionTimer: ReturnType<typeof setTimeout> | null = null;
    const finalize = () => {
      if (settled) {
        return;
      }
      settled = true;
      if (escalationTimer) {
        clearTimeout(escalationTimer);
      }
      if (completionTimer) {
        clearTimeout(completionTimer);
      }
      resolve();
    };

    processRef.once("close", finalize);
    processRef.once("exit", finalize);
    const termSent = processRef.kill("SIGTERM");
    if (hasExited(processRef)) {
      finalize();
      return;
    }

    escalationTimer = setTimeout(() => {
      if (hasExited(processRef)) {
        finalize();
        return;
      }
      const killSent = processRef.kill("SIGKILL");
      if (!killSent || hasExited(processRef)) {
        finalize();
        return;
      }
      // A descendant retaining stdio can delay ChildProcess "close" after the
      // direct child exits. Bound teardown so the radio scheduler recovers.
      completionTimer = setTimeout(finalize, graceMs);
    }, termSent ? graceMs : 0);
  });
}
