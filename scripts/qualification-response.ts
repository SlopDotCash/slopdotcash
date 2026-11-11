import { readBoundedText } from "../src/lib/browser-json";
import { providerCost } from "../workers/slopbot/models";

/** Read one capped qualification response without consuming the SDK's copy. */
export async function qualificationResponse(
  response: Response,
  provider: "surplus" | "orbio" = "surplus",
) {
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
  let cost = providerCost(response.headers, value, provider);
  if (provider === "orbio" && cost === null) {
    const usage =
      value !== null && typeof value === "object"
        ? (value as { usage?: unknown }).usage
        : undefined;
    const usd =
      usage !== null && typeof usage === "object"
        ? (usage as { cost?: unknown }).cost
        : undefined;
    if (typeof usd === "number" && Number.isFinite(usd) && usd >= 0) {
      const ceiling = Math.ceil(usd * 1_000_000);
      if (Number.isSafeInteger(ceiling)) cost = ceiling;
    }
  }
  return {
    value,
    // This qualification-only spending bound rounds a known fractional Orbio
    // micro-dollar upward. It is not an actual-cost ledger receipt: production
    // providerCost keeps an unrepresentable fractional charge unknown. Missing
    // or invalid charges refuse, and Surplus fields cannot prove an Orbio cost.
    cost,
    // Rebuild from the same complete UTF-8 body. Reading a clone can deadlock
    // cancellation of an oversized response while its other branch is unread.
    response: new Response(source, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }),
  };
}
