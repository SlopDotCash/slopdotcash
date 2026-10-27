import { readBoundedText } from "../src/lib/browser-json";
import { providerCost } from "../workers/slopbot/models";

/** Read one capped qualification response without consuming the SDK's copy. */
export async function qualificationResponse(response: Response) {
  // Qualification requests cap output at 1,024 or 2,048 tokens. This also
  // bounds the provider envelope and any long-response whitespace padding.
  let source: string;
  try {
    source = await readBoundedText(response, 1_048_576, "Provider receipt");
  } catch (error) {
    // A rejected Content-Length may leave the original body unread.
    void response.body?.cancel().catch(() => {});
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("Provider receipt returned invalid JSON");
  }
  return {
    value,
    cost: providerCost(response.headers, value),
    // Rebuild from the same complete UTF-8 body. Reading a clone can deadlock
    // cancellation of an oversized response while its other branch is unread.
    response: new Response(source, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
  };
}
