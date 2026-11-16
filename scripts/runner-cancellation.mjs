import { setImmediate } from "node:timers/promises";

/** Signal wiring and outcome ordering; runE2ePhase owns all child cleanup. */
export function createRunnerCancellation() {
  const controller = new AbortController();
  const handlers = new Map();
  let exitCode = 0;
  const record = (status) => {
    if (Number.isInteger(status) && status !== 0 && exitCode === 0)
      exitCode = status;
  };
  const abort = (status = 1) => {
    record(status);
    controller.abort();
  };
  for (const [signal, status] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
    ["SIGHUP", 129],
  ]) {
    const handle = () => abort(status);
    handlers.set(signal, handle);
    process.on(signal, handle);
  }
  return {
    signal: controller.signal,
    record,
    abort,
    get exitCode() {
      return exitCode;
    },
    check() {
      controller.signal.throwIfAborted();
    },
    async checkpoint() {
      // Let a signal queued during synchronous setup run before another spawn.
      await setImmediate();
      controller.signal.throwIfAborted();
    },
    dispose() {
      for (const [signal, handle] of handlers) process.off(signal, handle);
    },
  };
}
