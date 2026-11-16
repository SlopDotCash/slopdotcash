/** Types for the per-project generated-skill publication. */

import type { ProjectDefinition } from "./projects.mjs";

export interface SkillTemplatePublication {
  readonly commit: string;
  readonly revisionStatus: "committed" | "working-tree";
  readonly contributor: {
    readonly sourcePath: string;
    readonly files: readonly {
      readonly path: string;
      readonly sha256: string;
    }[];
  };
  readonly reviewer: {
    readonly sourcePath: string;
    readonly files: readonly {
      readonly path: string;
      readonly sha256: string;
    }[];
  };
  readonly renderer: {
    readonly paths: readonly string[];
    readonly revisionStatus: "committed" | "working-tree";
  };
  readonly acceptedRevisions: readonly string[];
}

export declare const SOURCE_REPOSITORY: "SlopDotCash/slopdotcash";
export declare const PUBLIC_SITE_ORIGIN: "https://slop.cash";
export declare const GUIDE_RENDERER_PATHS: readonly string[];
export declare const ACCEPTED_SKILL_REVISIONS: readonly string[];
export declare function storedZip(
  entries: readonly { path: string; bytes: Uint8Array }[],
): Uint8Array;
export declare function buildProjectPublication(input: {
  template: SkillTemplatePublication;
  readFile: (path: string) => Promise<Uint8Array>;
  project: ProjectDefinition;
  revision: number;
  manifestSha256: string;
  generatedAt: string;
}): Promise<Record<string, Uint8Array> | null>;
