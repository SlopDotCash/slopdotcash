//@ backend dafny
// spec/slopbot/valueEvidence.md, "Story: Value only evidence that is complete and hash-verified"; spec/slopbot/valueEvidence.md, "A blob, tree or binary claim counts only when its git object hash matches the bytes read"

export const policyPath = "CONTRIBUTING.md";
const declarationPrefix = "Pull requests target `";

export interface PolicyFacts { id: string; projectId: string; integrationBranch: string; expectedNodeId: string | null }
export interface PolicyFile { baseSha: string; path: string; text: string }
export interface Fence { marker: number; run: number; bare: boolean }

/** @throws {never} */
//@ pure
export function asciiLower(code: number): number {
  return 65 <= code && code <= 90 ? code + 32 : code;
}

/** @throws {never} */
//@ pure
export function isLineTerminator(code: number): boolean {
  return code === 10 || code === 13 || code === 8232 || code === 8233;
}

/** @throws {never} */
//@ pure
export function isTrimSpace(code: number): boolean {
  return code === 9 || code === 11 || code === 12 || code === 32 || code === 160 || code === 5760 ||
    (8192 <= code && code <= 8202) || code === 8239 || code === 8287 || code === 12288 || code === 65279;
}

/** @throws {never} */
export function sameRepositoryName(left: string, right: string): boolean {
  //@ ensures \result <==> left.length == right.length && forall(i, 0 <= i && i < left.length ==> asciiLower(left.charCodeAt(i)) == asciiLower(right.charCodeAt(i)))
  if (left.length !== right.length) return false;
  let i = 0;
  while (i < left.length) {
    //@ invariant 0 <= i && i <= left.length
    //@ invariant forall(k, 0 <= k && k < i ==> asciiLower(left.charCodeAt(k)) == asciiLower(right.charCodeAt(k)))
    //@ decreases left.length - i
    if (asciiLower(left.charCodeAt(i)) !== asciiLower(right.charCodeAt(i))) return false;
    i = i + 1;
  }
  return true;
}

/** @throws {never} */
export function namesRepository(names: string[], name: string): boolean {
  //@ ensures \result <==> exists(k, 0 <= k && k < names.length && names[k].length == name.length && forall(i, 0 <= i && i < name.length ==> asciiLower(names[k].charCodeAt(i)) == asciiLower(name.charCodeAt(i))))
  let k = 0;
  while (k < names.length) {
    //@ invariant 0 <= k && k <= names.length
    //@ invariant forall(j, 0 <= j && j < k ==> !(names[j].length == name.length && forall(i, 0 <= i && i < name.length ==> asciiLower(names[j].charCodeAt(i)) == asciiLower(name.charCodeAt(i)))))
    //@ decreases names.length - k
    if (sameRepositoryName(names[k], name)) return true;
    k = k + 1;
  }
  return false;
}

/** @throws {never} */
export function sourceMatchesPolicy(names: string[], expectedNodeId: string | null, repository: string, repositoryNodeId: string): boolean {
  //@ ensures \result ==> expectedNodeId === null || expectedNodeId === repositoryNodeId
  return namesRepository(names, repository) && (expectedNodeId === null || expectedNodeId === repositoryNodeId);
}

/** @throws {never} */
export function recordMatchesRegistration(recorded: PolicyFacts | null, registered: PolicyFacts, names: string[], repository: string, repositoryNodeId: string): boolean {
  //@ ensures \result ==> recorded !== null && recorded.id === registered.id && recorded.projectId === registered.projectId && recorded.integrationBranch === registered.integrationBranch && recorded.expectedNodeId === registered.expectedNodeId
  //@ ensures \result ==> registered.expectedNodeId === null || registered.expectedNodeId === repositoryNodeId
  return recorded !== null && recorded.id === registered.id && recorded.projectId === registered.projectId &&
    recorded.integrationBranch === registered.integrationBranch && recorded.expectedNodeId === registered.expectedNodeId &&
    sourceMatchesPolicy(names, registered.expectedNodeId, repository, repositoryNodeId);
}

/** @throws {never} */
export function startsAt(text: string, prefix: string, at: number): boolean {
  //@ requires 0 <= at
  //@ ensures \result ==> at + prefix.length <= text.length
  if (at + prefix.length > text.length) return false;
  let k = 0;
  while (k < prefix.length) {
    //@ invariant 0 <= k && k <= prefix.length
    //@ decreases prefix.length - k
    if (text.charCodeAt(at + k) !== prefix.charCodeAt(k)) return false;
    k = k + 1;
  }
  return true;
}

/** @throws {never} */
export function commentEnd(text: string, from: number): number {
  //@ requires 0 <= from && from <= text.length
  //@ ensures from <= \result && \result <= text.length
  let j = from;
  while (j < text.length) {
    //@ invariant from <= j && j <= text.length
    //@ decreases text.length - j
    if (startsAt(text, "-->", j)) return j + 3;
    j = j + 1;
  }
  return text.length;
}

/** @throws {never} */
export function withoutHtmlComments(text: string): string {
  //@ ensures \result.length <= text.length
  let kept = "";
  let i = 0;
  while (i < text.length) {
    //@ invariant 0 <= i && i <= text.length
    //@ invariant kept.length <= i
    //@ decreases text.length - i
    if (startsAt(text, "<!--", i)) i = commentEnd(text, i + 4);
    else {
      kept = kept + text.slice(i, i + 1);
      i = i + 1;
    }
  }
  return kept;
}

/** @throws {never} */
export function fenceOf(line: string): Fence | null {
  //@ ensures \result !== null ==> \result.run >= 3 && (\result.marker === 96 || \result.marker === 126)
  let i = 0;
  while (i < line.length && i < 3 && line.charCodeAt(i) === 32) {
    //@ invariant 0 <= i && i <= 3 && i <= line.length
    //@ decreases 3 - i
    i = i + 1;
  }
  if (i >= line.length) return null;
  const marker = line.charCodeAt(i);
  if (marker !== 96 && marker !== 126) return null;
  let j = i;
  while (j < line.length && line.charCodeAt(j) === marker) {
    //@ invariant i <= j && j <= line.length
    //@ decreases line.length - j
    j = j + 1;
  }
  if (j - i < 3) return null;
  let bare = true;
  let k = j;
  while (k < line.length) {
    //@ invariant j <= k && k <= line.length
    //@ decreases line.length - k
    const code = line.charCodeAt(k);
    if (isLineTerminator(code)) return null;
    if (!isTrimSpace(code)) bare = false;
    k = k + 1;
  }
  return { marker: marker, run: j - i, bare: bare };
}

/** @throws {never} */
export function declarationOf(line: string): string | null {
  //@ ensures \result !== null ==> \result.length > 0
  if (!startsAt(line, declarationPrefix, 0)) return null;
  let j = declarationPrefix.length;
  while (j < line.length && line.charCodeAt(j) !== 96 && line.charCodeAt(j) !== 13 && line.charCodeAt(j) !== 10) {
    //@ invariant declarationPrefix.length <= j && j <= line.length
    //@ decreases line.length - j
    j = j + 1;
  }
  if (j === declarationPrefix.length || j + 1 >= line.length) return null;
  if (line.charCodeAt(j) !== 96 || line.charCodeAt(j + 1) !== 46) return null;
  return line.slice(declarationPrefix.length, j);
}

/** @throws {never} */
export function declaredIntegrationBranch(source: string): string | null {
  //@ ensures \result !== null ==> \result.length > 0
  const text = withoutHtmlComments(source);
  let found: string | null = null;
  let ambiguous = false;
  let open: Fence | null = null;
  let start = 0;
  let i = 0;
  while (i <= text.length) {
    //@ invariant 0 <= start && start <= i && i <= text.length + 1
    //@ invariant found === null || found.length > 0
    //@ decreases text.length + 1 - i
    if (i === text.length || text.charCodeAt(i) === 10) {
      const end = i > start && i < text.length && text.charCodeAt(i - 1) === 13 ? i - 1 : i;
      const line = text.slice(start, end);
      const fence = fenceOf(line);
      if (fence !== null) {
        if (open === null) open = fence;
        else if (fence.marker === open.marker && fence.run >= open.run && fence.bare) open = null;
      } else if (open === null) {
        const branch = declarationOf(line);
        if (branch !== null) {
          if (found === null) found = branch;
          else if (found !== branch) ambiguous = true;
        }
      }
      start = i + 1;
    }
    i = i + 1;
  }
  return ambiguous ? null : found;
}

/** @throws {never} */
export function declaresHistoricalBranch(policy: PolicyFile, baseSha: string, baseRef: string): boolean {
  //@ ensures \result ==> policy.baseSha === baseSha && policy.path === policyPath && baseRef.length > 0
  return policy.baseSha === baseSha && policy.path === policyPath && declaredIntegrationBranch(policy.text) === baseRef;
}
