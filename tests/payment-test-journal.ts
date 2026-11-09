// Test-only doubles shared by the payment relayer and executor tests: an
// in-memory signer journal and a local JSON-RPC node.
import type { JournalStore } from "../workers/payment-executor/binding-shared";

/** An in-memory journal that clones values like durable storage would. */
export function memoryJournal(): JournalStore {
  const values = new Map<string, unknown>();
  const journal: JournalStore = {
    async get<T>(key: string) {
      return structuredClone(values.get(key)) as T | undefined;
    },
    async put<T>(key: string, value: T) {
      values.set(key, structuredClone(value));
    },
    async transaction(callback) {
      return callback(journal);
    },
  };
  return journal;
}

/**
 * Serves `answer` as a JSON-RPC node on a free local port. An answer of the
 * form `{ error }` becomes a JSON-RPC error with code -32000.
 */
export function serveJsonRpc(
  answer: (method: string, params: unknown[]) => unknown,
) {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { id, method, params } = (await request.json()) as {
        id: number;
        method: string;
        params: unknown[];
      };
      const result = answer(method, params);
      return Response.json(
        result && typeof result === "object" && "error" in result
          ? {
              jsonrpc: "2.0",
              id,
              error: { code: -32000, message: result.error },
            }
          : { jsonrpc: "2.0", id, result },
      );
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}
