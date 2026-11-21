/** Types for wanted issues (PRD section 5). */

export declare const WANTED_LABEL: "slop-wanted";
export declare const WANTED_ISSUES_SHOWN: number;
export declare function assertWantedIssues(
  value: unknown,
  field: string,
): asserts value is boolean;
export declare function wantedLabel(
  project:
    | { readonly slopbot?: { readonly wantedIssues?: boolean } }
    | null
    | undefined,
): "slop-wanted" | null;
