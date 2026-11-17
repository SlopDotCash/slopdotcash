//@ backend dafny
// spec/contributor/rendering.md, "Substitution is one pass over the four published placeholders and any other SLOP placeholder refuses"

export interface Placeholders {
  skillName: string;
  projectId: string;
  repository: string;
  integrationBranch: string;
}

export type Substituted = { kind: "substituted"; text: string } | { kind: "refusedPlaceholder" };

const opening = "{{SLOP_";
const skillToken = "{{SLOP_SKILL_NAME}}";
const projectToken = "{{SLOP_PROJECT_ID}}";
const repositoryToken = "{{SLOP_REPOSITORY}}";
const branchToken = "{{SLOP_INTEGRATION_BRANCH}}";
const fencedBranchToken = "`{{SLOP_INTEGRATION_BRANCH}}`";

/** @throws {never} */
//@ pure
export function backtickRunEndingAt(value: string, end: number): number {
  //@ requires 0 <= end && end <= value.length
  //@ ensures \result >= 0
  //@ decreases end
  if (end === 0) {
    return 0;
  }
  if (value.slice(end - 1, end) === "`") {
    return backtickRunEndingAt(value, end - 1) + 1;
  }
  return 0;
}

/** @throws {never} */
//@ pure
export function longestBacktickRun(value: string, end: number): number {
  //@ requires 0 <= end && end <= value.length
  //@ ensures \result >= 0
  //@ ensures \result === 0 <==> forall(j, (0 <= j && j < end) ==> value.slice(j, j + 1) !== "`")
  //@ decreases end
  if (end === 0) {
    return 0;
  }
  const run = backtickRunEndingAt(value, end);
  const before = longestBacktickRun(value, end - 1);
  return run > before ? run : before;
}

/** @throws {never} */
//@ pure
export function branchCode(value: string): string {
  //@ ensures longestBacktickRun(value, value.length) === 0 ==> \result === "`" + value + "`"
  //@ ensures longestBacktickRun(value, value.length) > 0 ==> \result === "`".repeat(longestBacktickRun(value, value.length) + 1) + " " + value + " " + "`".repeat(longestBacktickRun(value, value.length) + 1)
  const longest = longestBacktickRun(value, value.length);
  if (longest < 1) {
    return "`" + value + "`";
  }
  const fence = "`".repeat(longest + 1);
  return fence + " " + value + " " + fence;
}

/** @throws {never} */
//@ pure
export function withoutTokenFrom(text: string, token: string, i: number): string {
  //@ requires token.length > 0 && 0 <= i && i <= text.length
  //@ decreases text.length - i
  if (i === text.length) {
    return "";
  }
  if (text.slice(i).startsWith(token)) {
    return withoutTokenFrom(text, token, i + token.length);
  }
  return text.slice(i, i + 1) + withoutTokenFrom(text, token, i + 1);
}

/** @throws {never} */
//@ pure
export function strayPlaceholder(text: string): boolean {
  return withoutTokenFrom(withoutTokenFrom(withoutTokenFrom(withoutTokenFrom(text, skillToken, 0), projectToken, 0), repositoryToken, 0), branchToken, 0).includes(opening);
}

/** @throws {never} */
//@ pure
export function unknownPlaceholderFrom(text: string, i: number): boolean {
  //@ requires 0 <= i && i <= text.length
  //@ decreases text.length - i
  if (i === text.length) {
    return false;
  }
  const rest = text.slice(i);
  if (rest.startsWith(fencedBranchToken)) {
    return unknownPlaceholderFrom(text, i + fencedBranchToken.length);
  }
  if (rest.startsWith(skillToken)) {
    return unknownPlaceholderFrom(text, i + skillToken.length);
  }
  if (rest.startsWith(projectToken)) {
    return unknownPlaceholderFrom(text, i + projectToken.length);
  }
  if (rest.startsWith(repositoryToken)) {
    return unknownPlaceholderFrom(text, i + repositoryToken.length);
  }
  if (rest.startsWith(branchToken)) {
    return unknownPlaceholderFrom(text, i + branchToken.length);
  }
  if (rest.startsWith(opening)) {
    return true;
  }
  return unknownPlaceholderFrom(text, i + 1);
}

/** @throws {never} */
//@ pure
export function substitutedFrom(text: string, values: Placeholders, i: number): string {
  //@ requires 0 <= i && i <= text.length
  //@ decreases text.length - i
  if (i === text.length) {
    return "";
  }
  const rest = text.slice(i);
  if (rest.startsWith(fencedBranchToken)) {
    return branchCode(values.integrationBranch) + substitutedFrom(text, values, i + fencedBranchToken.length);
  }
  if (rest.startsWith(skillToken)) {
    return values.skillName + substitutedFrom(text, values, i + skillToken.length);
  }
  if (rest.startsWith(projectToken)) {
    return values.projectId + substitutedFrom(text, values, i + projectToken.length);
  }
  if (rest.startsWith(repositoryToken)) {
    return values.repository + substitutedFrom(text, values, i + repositoryToken.length);
  }
  if (rest.startsWith(branchToken)) {
    return values.integrationBranch + substitutedFrom(text, values, i + branchToken.length);
  }
  return text.slice(i, i + 1) + substitutedFrom(text, values, i + 1);
}

/** @throws {never} */
export function withoutToken(text: string, token: string): string {
  //@ requires token.length > 0
  //@ ensures \result === withoutTokenFrom(text, token, 0)
  let out = "";
  let i = 0;
  while (i < text.length) {
    //@ invariant 0 <= i && i <= text.length
    //@ invariant out + withoutTokenFrom(text, token, i) === withoutTokenFrom(text, token, 0)
    //@ decreases text.length - i
    if (text.slice(i).startsWith(token)) {
      i = i + token.length;
    } else {
      out = out + text.slice(i, i + 1);
      i = i + 1;
    }
  }
  return out;
}

/** @throws {never} */
export function holdsStrayPlaceholder(text: string): boolean {
  //@ ensures \result === strayPlaceholder(text)
  const checked = withoutToken(withoutToken(withoutToken(withoutToken(text, skillToken), projectToken), repositoryToken), branchToken);
  return checked.includes(opening);
}

/** @throws {never} */
export function substitute(text: string, values: Placeholders): Substituted {
  //@ ensures strayPlaceholder(text) ==> \result.kind === "refusedPlaceholder"
  //@ ensures \result.kind === "refusedPlaceholder" <==> (strayPlaceholder(text) || unknownPlaceholderFrom(text, 0))
  //@ ensures \result.kind === "substituted" ==> \result.text === substitutedFrom(text, values, 0)
  if (holdsStrayPlaceholder(text)) {
    return { kind: "refusedPlaceholder" };
  }
  let out = "";
  let i = 0;
  while (i < text.length) {
    //@ invariant 0 <= i && i <= text.length
    //@ invariant out + substitutedFrom(text, values, i) === substitutedFrom(text, values, 0)
    //@ invariant unknownPlaceholderFrom(text, i) === unknownPlaceholderFrom(text, 0)
    //@ decreases text.length - i
    const rest = text.slice(i);
    if (rest.startsWith(fencedBranchToken)) {
      out = out + branchCode(values.integrationBranch);
      i = i + fencedBranchToken.length;
    } else if (rest.startsWith(skillToken)) {
      out = out + values.skillName;
      i = i + skillToken.length;
    } else if (rest.startsWith(projectToken)) {
      out = out + values.projectId;
      i = i + projectToken.length;
    } else if (rest.startsWith(repositoryToken)) {
      out = out + values.repository;
      i = i + repositoryToken.length;
    } else if (rest.startsWith(branchToken)) {
      out = out + values.integrationBranch;
      i = i + branchToken.length;
    } else if (rest.startsWith(opening)) {
      return { kind: "refusedPlaceholder" };
    } else {
      out = out + text.slice(i, i + 1);
      i = i + 1;
    }
  }
  return { kind: "substituted", text: out };
}
