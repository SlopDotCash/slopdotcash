/** Evidence transport and file-change records shared by the value evidence collectors. */

// Shared by the installation worker and the historical reviewer. Missing or
// moving evidence prevents assessment; pagination limits never imply coverage.
export interface EvidenceClient {
  get<T>(path: string): Promise<T | null>;
  graphql?<T>(query: string, variables: Record<string, unknown>): Promise<T>;
}

export interface FileChange {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
  blob_url: string | null;
  fullComparison?: {
    baseSha: string;
    headSha: string;
    before: { blobSha: string; text: string };
    after: { blobSha: string; text: string };
  };
  removedComparison?: {
    baseSha: string;
    headSha: string;
    before: { blobSha: string; text: string };
  };
  addedComparison?: {
    baseSha: string;
    headSha: string;
    after: { blobSha: string; text: string };
  };
  unchangedRename?: { baseSha: string; headSha: string; blobSha: string };
  addedBinary?: AddedBinaryProof;
}

/** Private source bytes, not a textual patch or proof of what a recording shows. */
export interface AddedBinaryProof {
  schemaVersion: 1;
  path: string;
  baseSha: string;
  headSha: string;
  baseTreeSha: string;
  headTreeSha: string;
  mode: "100644";
  blobSha: string;
  size: number;
  sha256: string;
  contentBase64: string;
  contentReview: "unviewed";
}
