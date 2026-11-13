/** Attach immediately after spawn; this does not supervise descendants. */
export function observeEvidenceProcess(child) {
  const state = { closed: false, error: undefined, completion: undefined };
  state.completion = new Promise((resolve) => {
    child.on("error", (error) => {
      // Keep the first failure and consume later errors while cleanup proceeds.
      state.error ??= error;
    });
    child.once("close", (code, signal) => {
      state.closed = true;
      resolve({ code, signal });
    });
  });
  return state;
}

/** A command is complete only after the child's close event. */
export async function completeEvidenceCommand(command, state) {
  const { code, signal } = await state.completion;
  if (state.error) throw state.error;
  if (code !== 0) {
    throw new Error(
      `${command} exited with ${code ?? "unknown"}${signal ? ` (${signal})` : ""}`,
    );
  }
}

function waitForClose(state, timeoutMs) {
  if (state.closed) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (closed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(closed);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    state.completion.then(() => finish(true));
  });
}

function isRunning(child) {
  return (
    child.pid !== undefined &&
    child.exitCode === null &&
    child.signalCode === null
  );
}

/** Failed spawn, observed exit, requested termination and close are distinct. */
export async function stopEvidencePreview(child, state, timeoutMs = 3_000) {
  if (!child || state.closed) return;
  const signalErrors = [];
  const rememberObservedError = () => {
    if (state.error && !signalErrors.includes(state.error)) {
      signalErrors.push(state.error);
    }
  };
  const requestStop = (signal) => {
    rememberObservedError();
    if (!isRunning(child)) return;
    try {
      child.kill(signal);
    } catch (error) {
      rememberObservedError();
      signalErrors.push(error);
    }
    rememberObservedError();
  };
  requestStop("SIGTERM");
  if (await waitForClose(state, timeoutMs)) return;
  requestStop("SIGKILL");
  if (await waitForClose(state, timeoutMs)) return;
  const error = new Error("[Slop] owned preview did not close after shutdown");
  rememberObservedError();
  if (signalErrors.length > 0) {
    throw new AggregateError(
      [...signalErrors, error],
      "[Slop] preview shutdown failed and closure remains unconfirmed",
      { cause: signalErrors[0] },
    );
  }
  throw error;
}
