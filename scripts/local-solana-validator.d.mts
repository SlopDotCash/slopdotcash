import type { ChildProcess, StdioOptions } from "node:child_process";

export declare const SOLANA_TEST_IMAGE: string;
export declare const SOLANA_TEST_BINARY_SHA256: string;
export declare function startLocalSolanaValidator(options: {
  args: readonly string[];
  rpcPort: number;
  runtime?: "docker" | "podman";
  readonlyMounts?: readonly string[];
  stdio?: StdioOptions;
  receiptPath?: string;
}): Promise<{
  process: ChildProcess;
  close(): Promise<void>;
  receipt: {
    name: string;
    state: string;
    [key: string]: unknown;
  };
}>;
