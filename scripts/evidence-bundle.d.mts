export function withEvidenceCleanup<T>(
  operation: () => T | Promise<T>,
  cleanups: { label: string; run: () => unknown | Promise<unknown> }[],
): Promise<T>;
