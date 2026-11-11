/** Child lifecycle regressions with in-process emitters; no process is spawned. */
import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { withEvidenceCleanup } from "./evidence-bundle.mjs";
import {
  completeEvidenceCommand,
  observeEvidenceProcess,
  stopEvidencePreview,
} from "./evidence-process.mjs";

class ChildFixture extends EventEmitter {
  pid: number | undefined;
  exitCode: number | null = null;
  signalCode: string | null = null;
  signals: string[] = [];
  onKill: ((signal: string) => boolean) | undefined;

  constructor(spawned = true) {
    super();
    this.pid = spawned ? 1234 : undefined;
  }

  kill(signal: string) {
    this.signals.push(signal);
    return this.onKill?.(signal) ?? true;
  }

  exit(code: number | null, signal: string | null = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
  }

  failSpawn(error: Error, code = -2) {
    // Pinned Node records the negative status before emitting error, not exit.
    this.exitCode = code;
    this.emit("error", error);
  }

  close(code = this.exitCode, signal = this.signalCode) {
    this.emit("close", code, signal);
  }
}

type ProcessError = Error & { cause?: unknown; errors?: unknown[] };

async function failure(result: Promise<unknown>): Promise<ProcessError> {
  try {
    await result;
  } catch (error) {
    if (error instanceof Error) return error as ProcessError;
    throw error;
  }
  throw new Error("Expected child lifecycle failure");
}

test("command success waits for close after zero exit", async () => {
  const child = new ChildFixture();
  const state = observeEvidenceProcess(child);
  const result = completeEvidenceCommand("fixture-build", state);
  let settled = false;
  void result.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  child.exit(0);
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(state.closed).toBe(false);
  child.close();
  await result;
  expect(settled).toBe(true);
  expect(state.closed).toBe(true);
});

test("nonzero command close retains the exit code", async () => {
  const child = new ChildFixture();
  const state = observeEvidenceProcess(child);
  const rejected = failure(completeEvidenceCommand("fixture-build", state));
  child.exit(7);
  child.close();
  expect((await rejected).message).toBe("fixture-build exited with 7");
});

test("signal command close refuses success and names the signal", async () => {
  const child = new ChildFixture();
  const state = observeEvidenceProcess(child);
  const rejected = failure(completeEvidenceCommand("fixture-encoder", state));
  child.exit(null, "SIGTERM");
  child.close();
  expect((await rejected).message).toBe(
    "fixture-encoder exited with unknown (SIGTERM)",
  );
});

test("failed-spawn command waits for close without requiring exit", async () => {
  const child = new ChildFixture(false);
  const state = observeEvidenceProcess(child);
  const primary = new Error("fixture ENOENT");
  const result = completeEvidenceCommand("missing-build", state);
  const rejected = failure(result);
  let settled = false;
  void result.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  child.failSpawn(primary);
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(child.exitCode).toBe(-2);
  expect(child.signalCode).toBeNull();
  child.close(-2, null);
  expect(await rejected).toBe(primary);
  expect(child.signals).toEqual([]);
});

test("command preserves the first error and consumes later child errors", async () => {
  const child = new ChildFixture();
  const state = observeEvidenceProcess(child);
  const primary = new Error("fixture first child error");
  const rejected = failure(completeEvidenceCommand("fixture-build", state));
  child.emit("error", primary);
  child.emit("error", new Error("fixture later child error"));
  child.exit(0);
  child.close();
  expect(await rejected).toBe(primary);
  expect(() =>
    child.emit("error", new Error("fixture error after settlement")),
  ).not.toThrow();
  expect(state.error).toBe(primary);
});

test("command completion also observes a close that already occurred", async () => {
  const child = new ChildFixture();
  const state = observeEvidenceProcess(child);
  child.exit(0);
  child.close();
  await completeEvidenceCommand("fixture-build", state);
  expect(state.closed).toBe(true);
});

test("failed-spawn preview closes without any signal or false cleanup error", async () => {
  const child = new ChildFixture(false);
  const state = observeEvidenceProcess(child);
  child.failSpawn(new Error("fixture preview ENOENT"));
  const result = stopEvidencePreview(child, state, 100);
  child.close(-2, null);
  await result;
  expect(child.signals).toEqual([]);
  expect(state.closed).toBe(true);
});

test("preview startup rejection survives successful failed-spawn cleanup unchanged", async () => {
  const child = new ChildFixture(false);
  const state = observeEvidenceProcess(child);
  const primary = new Error("fixture preview could not start");
  child.failSpawn(new Error("fixture native spawn error"));
  const result = withEvidenceCleanup(async () => {
    throw primary;
  }, [
    {
      label: "preview shutdown",
      run: () => stopEvidencePreview(child, state, 100),
    },
  ]);
  const rejected = failure(result);
  queueMicrotask(() => child.close(-2, null));
  expect(await rejected).toBe(primary);
  expect(child.signals).toEqual([]);
});

test("already exited preview waits for close and receives no signals", async () => {
  const child = new ChildFixture();
  const state = observeEvidenceProcess(child);
  child.exit(0);
  const result = stopEvidencePreview(child, state, 100);
  let settled = false;
  void result.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(child.signals).toEqual([]);
  child.close();
  await result;
  expect(state.closed).toBe(true);
});

test("closed preview cleanup is a repeatable no-op", async () => {
  const child = new ChildFixture();
  const state = observeEvidenceProcess(child);
  child.exit(0);
  child.close();
  await stopEvidencePreview(child, state, 100);
  await stopEvidencePreview(child, state, 100);
  expect(child.signals).toEqual([]);
});

test("absent production-mode preview cleanup is a no-op", async () => {
  await stopEvidencePreview(undefined, undefined, 100);
});

test("preview termination alone does not complete cleanup before close", async () => {
  const child = new ChildFixture();
  const state = observeEvidenceProcess(child);
  child.onKill = () => {
    child.exit(null, "SIGTERM");
    return true;
  };
  const result = stopEvidencePreview(child, state, 100);
  let settled = false;
  void result.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(child.signals).toEqual(["SIGTERM"]);
  child.close();
  await result;
});

test("preview shutdown escalates after grace and waits for kill close", async () => {
  const child = new ChildFixture();
  const state = observeEvidenceProcess(child);
  child.onKill = (signal) => {
    if (signal === "SIGKILL") {
      child.exit(null, signal);
      queueMicrotask(() => child.close());
    }
    return true;
  };
  await stopEvidencePreview(child, state, 10);
  expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
  expect(state.closed).toBe(true);
});

test("false signal result still permits success on independently observed close", async () => {
  const child = new ChildFixture();
  const state = observeEvidenceProcess(child);
  child.onKill = () => false;
  const result = stopEvidencePreview(child, state, 100);
  child.exit(0);
  child.close();
  await result;
  expect(child.signals).toEqual(["SIGTERM"]);
});

test("false signal results never prove closure and late close does not change rejection", async () => {
  const child = new ChildFixture();
  const state = observeEvidenceProcess(child);
  child.onKill = () => false;
  const result = stopEvidencePreview(child, state, 10);
  let settlements = 0;
  void result.then(
    () => {
      settlements++;
    },
    () => {
      settlements++;
    },
  );
  const error = await failure(result);
  expect(error.message).toContain("did not close after shutdown");
  expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
  expect(state.closed).toBe(false);
  child.exit(null, "SIGKILL");
  child.close();
  await state.completion;
  expect(settlements).toBe(1);
  expect(state.closed).toBe(true);
});

test("signal exception does not prevent success when close is observed", async () => {
  const child = new ChildFixture();
  const state = observeEvidenceProcess(child);
  child.onKill = () => {
    throw new Error("fixture signal request failed");
  };
  const result = stopEvidencePreview(child, state, 100);
  child.exit(0);
  child.close();
  await result;
  expect(child.signals).toEqual(["SIGTERM"]);
});

test("thrown TERM still reaches KILL fallback and awaits its close", async () => {
  const child = new ChildFixture();
  const state = observeEvidenceProcess(child);
  const primary = new Error("fixture TERM is unsupported");
  child.onKill = (signal) => {
    if (signal === "SIGTERM") throw primary;
    child.exit(null, signal);
    queueMicrotask(() => child.close());
    return true;
  };
  await stopEvidencePreview(child, state, 10);
  expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
  expect(state.closed).toBe(true);
});

test("unconfirmed shutdown preserves both thrown signal errors", async () => {
  const child = new ChildFixture();
  const state = observeEvidenceProcess(child);
  const term = new Error("fixture TERM failed");
  const kill = new Error("fixture KILL failed");
  child.onKill = (signal) => {
    throw signal === "SIGTERM" ? term : kill;
  };
  const error = await failure(stopEvidencePreview(child, state, 10));
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.cause).toBe(term);
  expect(error.errors?.slice(0, 2)).toEqual([term, kill]);
  expect((error.errors?.[2] as Error | undefined)?.message).toContain(
    "did not close after shutdown",
  );
  expect(state.closed).toBe(false);
});

test("later asynchronous KILL error cannot replace the earlier thrown TERM cause", async () => {
  const child = new ChildFixture();
  const state = observeEvidenceProcess(child);
  const term = new Error("fixture earlier TERM exception");
  const kill = new Error("fixture later asynchronous KILL error");
  child.onKill = (signal) => {
    if (signal === "SIGTERM") throw term;
    child.emit("error", kill);
    return false;
  };
  const error = await failure(stopEvidencePreview(child, state, 10));
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.cause).toBe(term);
  expect(error.errors?.slice(0, 2)).toEqual([term, kill]);
  expect((error.errors?.[2] as Error | undefined)?.message).toContain(
    "did not close after shutdown",
  );
  expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
  expect(state.closed).toBe(false);
});

test("unconfirmed shutdown retains the first asynchronous child error", async () => {
  const child = new ChildFixture();
  const state = observeEvidenceProcess(child);
  const primary = new Error("fixture asynchronous TERM error");
  child.onKill = (signal) => {
    child.emit(
      "error",
      signal === "SIGTERM" ? primary : new Error("fixture later KILL error"),
    );
    return false;
  };
  const error = await failure(stopEvidencePreview(child, state, 10));
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.cause).toBe(primary);
  expect(error.errors?.[0]).toBe(primary);
  expect(error.errors).toHaveLength(2);
  expect(state.closed).toBe(false);
});

test("failed spawn without close is explicit uncertainty rather than invented cleanup", async () => {
  const child = new ChildFixture(false);
  const state = observeEvidenceProcess(child);
  const primary = new Error("fixture spawn failed without close");
  child.failSpawn(primary);
  const error = await failure(stopEvidencePreview(child, state, 10));
  expect(error).toBeInstanceOf(AggregateError);
  expect(error.cause).toBe(primary);
  expect(child.signals).toEqual([]);
  expect(state.closed).toBe(false);
});

test("exited child without close times out without sending another signal", async () => {
  const child = new ChildFixture();
  const state = observeEvidenceProcess(child);
  child.exit(0);
  const error = await failure(stopEvidencePreview(child, state, 10));
  expect(error.message).toContain("did not close after shutdown");
  expect(child.signals).toEqual([]);
  expect(state.closed).toBe(false);
});
