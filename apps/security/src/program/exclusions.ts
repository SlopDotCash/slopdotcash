// spec/security/terms.md, "Exclusions are frozen with the terms and stay advice"; spec/security/routineDecisions.md, "Two independent calls must agree before a close, and a plausible loss of funds closes nothing"

export interface ExclusionScope {
  readonly excludedFindings?: ReadonlyArray<string>;
}

export const SECURITY_DEFAULT_EXCLUSIONS: ReadonlyArray<string> = Object.freeze([
  "No runnable proof against the published source revision (theory, scanner output, best-practice notes)",
  "Known issues, public issues, and risks the project documents as accepted or by design (for example owner, admin or upgrade powers)",
  "Attacks that need a compromised owner, admin, attester or other privileged key, or the reporter's own stolen keys or accounts",
  "Front end, website, DNS, email, phishing and social engineering",
  "Denial of service by traffic volume, spam, or gas griefing with no loss of funds",
  "Testnets, old revisions, and code outside the scoped commit",
  "Third-party dependencies outside the listed scope",
  "Duplicates: only the first qualifying reporter is considered",
  "Findings made by testing live systems or touching other people's funds",
  "Reports the reporter cannot reproduce or explain, including unverified AI output",
]);

export const ROUTINE_SEPARATE_RULES: ReadonlyArray<string> = Object.freeze([
  SECURITY_DEFAULT_EXCLUSIONS[0] ?? "",
  SECURITY_DEFAULT_EXCLUSIONS[7] ?? "",
  SECURITY_DEFAULT_EXCLUSIONS[9] ?? "",
]);

export const SECURITY_ROUTINE_DECISION_NOTICE =
  "Reports that match this list, duplicates of an earlier report and reports without proof are closed with a reason, and the reporter can appeal.";

export const SECURITY_EXCLUSION_LIMITS = Object.freeze({ maxLines: 20, minLength: 3, maxLength: 300 });

/** @throws {never} */
export function programExclusions(scope: ExclusionScope | null | undefined): ReadonlyArray<string> {
  return scope?.excludedFindings ?? [];
}

/** @throws {never} */
export function securityExclusions(scope: ExclusionScope | null | undefined): Array<string> {
  return [...SECURITY_DEFAULT_EXCLUSIONS, ...programExclusions(scope)];
}

/** @throws {never} */
export function exclusionLengths(scope: ExclusionScope | null | undefined): Array<number> {
  return programExclusions(scope).map((line) => line.length);
}

/** @throws {never} */
export function routineClosingLines(lines: ReadonlyArray<string>): Array<string> {
  return lines.filter((line) => !ROUTINE_SEPARATE_RULES.includes(line));
}

/** @throws {never} */
export function routineClosingExclusions(scope: ExclusionScope | null | undefined): Array<string> {
  return routineClosingLines(securityExclusions(scope));
}
