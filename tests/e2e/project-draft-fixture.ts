import { expect, type Page } from "@playwright/test";

/**
 * Hold a session read until the editor's committed DOM removal. Parent/child
 * tests may need later reads to advance the still-live parent; opt into one
 * shared gate for concurrent reads when testing a mutation's preflight.
 */
export async function holdProjectSessionUntilUnmount(
  page: Page,
  selector: string,
  pathSuffix = "/api/v1/project-session",
  { holdConcurrentReads = false }: { holdConcurrentReads?: boolean } = {},
) {
  await page.evaluate(
    ({ selector, pathSuffix, holdConcurrentReads }) => {
      const state = {
        waiting: false,
        waitingReads: 0,
        removed: false,
        released: false,
        release: () => {},
      };
      const released = new Promise<void>((resolve) => {
        state.release = () => {
          state.released = true;
          resolve();
        };
      });
      Object.assign(window, { heldEditorSession: state });
      const hold = () => {
        state.waiting = true;
        state.waitingReads += 1;
        return released;
      };
      const readJson = Response.prototype.json;
      Response.prototype.json = async function (this: Response) {
        const value = await readJson.call(this);
        if (
          (holdConcurrentReads || !state.waiting) &&
          this.url.endsWith(pathSuffix)
        )
          await hold();
        return value;
      };
      // Bounded readers parse the body stream instead of calling json().
      const readBody = Object.getOwnPropertyDescriptor(
        Response.prototype,
        "body",
      )?.get;
      if (!readBody) throw new Error("Response body getter is unavailable");
      const heldBodies = new WeakMap<Response, ReadableStream<Uint8Array>>();
      Object.defineProperty(Response.prototype, "body", {
        configurable: true,
        get(this: Response) {
          const held = heldBodies.get(this);
          if (held) return held;
          const body = readBody.call(this) as ReadableStream<Uint8Array> | null;
          if (
            !body ||
            (!holdConcurrentReads && state.waiting) ||
            !this.url.endsWith(pathSuffix)
          )
            return body;
          const reader = body.getReader();
          const parsed = hold().then(() => reader);
          const stream = new ReadableStream<Uint8Array>({
            async pull(controller) {
              const chunk = await (await parsed).read();
              if (chunk.done) controller.close();
              else controller.enqueue(chunk.value);
            },
            cancel: async (reason) => (await parsed).cancel(reason),
          });
          heldBodies.set(this, stream);
          return stream;
        },
      });
      // A native history transition commits outside the discrete click that
      // starts the request. Release before a later passive cleanup task runs.
      const observer = new MutationObserver(() => {
        if (state.waiting && !document.querySelector(selector)) {
          state.removed = true;
          state.release();
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    },
    { selector, pathSuffix, holdConcurrentReads },
  );
}

export async function leaveEditorWithHeldSession(page: Page) {
  await page.waitForFunction(
    () =>
      (window as typeof window & { heldEditorSession: { waiting: boolean } })
        .heldEditorSession.waiting,
  );
  await page.goBack();
  await page.waitForFunction(() => {
    const state = (
      window as typeof window & {
        heldEditorSession: { removed: boolean; released: boolean };
      }
    ).heldEditorSession;
    return state.removed && state.released;
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await expect(page).toHaveURL(/\/how-it-works$/u);
}

export async function releaseHeldEditorSession(page: Page) {
  if (page.isClosed()) return;
  await page.evaluate(() =>
    (
      window as typeof window & {
        heldEditorSession?: { release(): void };
      }
    ).heldEditorSession?.release(),
  );
}

/** Inspect the tab's saved bytes, including during legacy-format migration. */
export async function readProjectDraft(page: Page, key: string) {
  await expect(page.getByText("Saving draft…", { exact: true })).toHaveCount(0);
  return page.evaluate((key) => {
    const pointer = sessionStorage.getItem(
      `slop:project-draft:v3:${encodeURIComponent(key)}:tab`,
    );
    if (!pointer || pointer === "empty") return null;
    const record = JSON.parse(localStorage.getItem(pointer) ?? "null");
    return record ? JSON.parse(record.value) : null;
  }, key);
}

export async function readProposalDraft(page: Page) {
  return (await readProjectDraft(page, "slop:project-proposal:v1"))?.proposal;
}

/** Deliberately alter persisted input to test restoration of an invalid choice. */
export async function patchProposalDraft(
  page: Page,
  patch: Record<string, string>,
) {
  await readProjectDraft(page, "slop:project-proposal:v1");
  return page.evaluate((patch) => {
    const pointer = sessionStorage.getItem(
      `slop:project-draft:v3:${encodeURIComponent("slop:project-proposal:v1")}:tab`,
    );
    if (!pointer || pointer === "empty") throw new Error("No saved proposal");
    const record = JSON.parse(localStorage.getItem(pointer) ?? "null");
    const value = JSON.parse(record.value);
    Object.assign(value.proposal, patch);
    localStorage.setItem(
      pointer,
      JSON.stringify({ ...record, value: JSON.stringify(value) }),
    );
  }, patch);
}
