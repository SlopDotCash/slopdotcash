import { expect, type Page } from "@playwright/test";

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
