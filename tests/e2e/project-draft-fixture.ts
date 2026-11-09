import { expect, type Page } from "@playwright/test";

/** Hold a parsed preflight until the editor's committed DOM removal. */
export async function holdProjectSessionUntilUnmount(
  page: Page,
  selector: string,
  pathSuffix = "/api/v1/project-session",
) {
  await page.evaluate(
    ({ selector, pathSuffix }) => {
      const state = {
        waiting: false,
        removed: false,
        released: false,
        release: () => {},
      };
      Object.assign(window, { heldEditorSession: state });
      const readJson = Response.prototype.json;
      Response.prototype.json = async function (this: Response) {
        const value = await readJson.call(this);
        if (!state.waiting && this.url.endsWith(pathSuffix)) {
          state.waiting = true;
          await new Promise<void>((resolve) => {
            state.release = () => {
              state.released = true;
              resolve();
            };
          });
        }
        return value;
      };
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
    { selector, pathSuffix },
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
