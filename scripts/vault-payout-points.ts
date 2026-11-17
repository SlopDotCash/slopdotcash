/** Public, actor-scoped finalized payment reads. No wallet or aggregate identity inference. */
import { readBoundedJson } from "../src/lib/browser-json";
import { githubUserIdFromNodeId } from "../src/lib/github-actor";
import type { ActorRef } from "../src/lib/leaderboard-types";
import { readCompletePages } from "../src/lib/paged-history";
import {
  isPublicVaultPayment,
  type PublicVaultPayment,
  type PublicVaultPaymentPage,
} from "../src/lib/payments/contracts";
import type { ActorVaultPayments } from "../src/lib/payout-points";

export async function loadVaultPayouts(
  actors: Iterable<ActorRef>,
  origin: "https://slop.cash" | "https://staging.slop.cash",
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<ActorVaultPayments[]> {
  const people = new Map<string, ActorRef>();
  for (const actor of actors) {
    const id = githubUserIdFromNodeId(actor.id);
    if (id) people.set(id, actor);
  }
  const entries = [...people.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const rows: ActorVaultPayments[] = new Array(entries.length);
  let next = 0;
  // Every eligible monthly recipient already occurs in the contribution journal
  // used to propose the month. Query their permanent IDs, never a wallet join.
  await Promise.all(
    Array.from({ length: Math.min(8, entries.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= entries.length) return;
        const [id, actor] = entries[index];
        const payments = await readCompletePages<PublicVaultPayment>({
          fetchPage: async (query) => {
            const response = await request(
              `${origin}/api/v1/payments/actors/${id}/vault-payments${query}`,
              {
                redirect: "error",
                cache: "no-store",
                signal: AbortSignal.timeout(30000),
              },
            );
            if (!response.ok)
              throw new Error("Published payout history unavailable");
            const page = (await readBoundedJson(
              response,
              1_048_576,
              "payout history",
            )) as PublicVaultPaymentPage;
            if (
              !page ||
              !Array.isArray(page.payments) ||
              !page.payments.every(isPublicVaultPayment)
            )
              throw new Error("Invalid published payout history");
            return {
              rows: page.payments,
              through: page.through,
              total: page.total,
              next: page.next,
            };
          },
          key: (payment) => payment.id,
          errors: {
            history: "Invalid payout history",
            duplicate: "Duplicate payout record",
            count: "Payout history count differs",
            incomplete: "Incomplete payout history",
          },
        });
        rows[index] = { actor, payments };
      }
    }),
  );
  return rows;
}
