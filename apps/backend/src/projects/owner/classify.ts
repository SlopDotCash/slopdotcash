//@ backend dafny
// spec/backend/projects.md, "Owner revisions publish at once against the expected revision"; spec/backend/projects.md, "Appending a repository pauses the project and its work counts from next month"

export type ChangeClass = "presentation" | "executable" | "financial" | "restricted";

export interface RevisionChanges {
  readonly presentation: string[];
  readonly executable: string[];
  readonly financial: string[];
  readonly restricted: string[];
}

/** @throws {never} */
export function presentationField(field: string): boolean {
  //@ ensures \result === (field === "name" || field === "eyebrow" || field === "headline" || field === "image" || field === "description" || field === "links" || field === "security" || field === "slopbot")
  return field === "name" || field === "eyebrow" || field === "headline" || field === "image" || field === "description" || field === "links" || field === "security" || field === "slopbot";
}

/** @throws {never} */
export function financialField(field: string): boolean {
  //@ ensures \result === (field === "reward" || field === "rewardAsset" || field === "escrow" || field === "funding" || field === "securityBounty")
  return field === "reward" || field === "rewardAsset" || field === "escrow" || field === "funding" || field === "securityBounty";
}

/** @throws {never} */
export function classOf(field: string, appended: boolean): ChangeClass {
  //@ ensures (\result === "executable") === ((field === "repositories" && appended) || field === "contribution")
  //@ ensures \result === "presentation" ==> presentationField(field)
  //@ ensures \result === "financial" ==> financialField(field)
  //@ ensures (field === "id" || field === "skill" || field === "reviewSkill" || field === "status" || field === "listingTier" || field === "steward" || field === "authority" || field === "terms") ==> \result === "restricted"
  //@ ensures (field === "repositories" && !appended) ==> \result === "restricted"
  if (field === "repositories") return appended ? "executable" : "restricted";
  if (field === "contribution") return "executable";
  if (presentationField(field)) return "presentation";
  if (financialField(field)) return "financial";
  return "restricted";
}

/** @throws {never} */
export function classifyRevisionChanges(changed: string[], appended: boolean): RevisionChanges {
  //@ ensures \result.presentation.length + \result.executable.length + \result.financial.length + \result.restricted.length === changed.length
  const presentation: string[] = [];
  const executable: string[] = [];
  const financial: string[] = [];
  const restricted: string[] = [];
  let i = 0;
  while (i < changed.length) {
    //@ invariant 0 <= i && i <= changed.length
    //@ invariant presentation.length + executable.length + financial.length + restricted.length === i
    const kind = classOf(changed[i], appended);
    if (kind === "presentation") presentation.push(changed[i]);
    else if (kind === "executable") executable.push(changed[i]);
    else if (kind === "financial") financial.push(changed[i]);
    else restricted.push(changed[i]);
    i = i + 1;
  }
  return { presentation, executable, financial, restricted };
}
