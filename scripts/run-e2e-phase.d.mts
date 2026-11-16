export function runE2ePhase(options: {
  label: string;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
  interruptGraceMs?: number;
  cleanupGraceMs?: number;
  signal?: AbortSignal;
  interruptSignal?: NodeJS.Signals;
  browserOwnership?: boolean;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  onExit?: (status: number | null, signal: NodeJS.Signals | null) => void;
}): Promise<number>;
