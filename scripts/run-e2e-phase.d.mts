export function runE2ePhase(options: {
  label: string;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  interruptSignal?: NodeJS.Signals;
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
}): Promise<number>;
