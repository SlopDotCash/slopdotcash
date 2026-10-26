import {
  REFERRAL_CACHE_MAX_AGE_MS,
  type ReferralAccount,
  type ReferralClaim,
  referralResponse,
} from "../../src/lib/referral-claims";
import type { FileReferrer } from "../../workers/referral-accrual/core";
import { apiErrorResponse } from "../http";
import {
  activeClaimEpoch,
  type ClaimCacheRow,
  type ClaimSnapshot,
} from "./cache";

const headers = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });
interface ReadStatement {
  bind(...values: (string | number)[]): ReadStatement;
  first<T>(): Promise<T | null>;
}
type ReferralClaimsDependencies = {
  db: { prepare(query: string): ReadStatement };
  sessionActor(request: Request): Promise<{ githubId: string } | null>;
  now: () => Date;
};
export async function handleReferralClaims(
  request: Request,
  deps: ReferralClaimsDependencies,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== "/api/v1/referrals/me") return null;
  if (request.method !== "GET")
    return json({ error: "method_not_allowed" }, 405);
  try {
    return await referralAccount(request, deps);
  } catch (caught) {
    return apiErrorResponse(caught, {
      label: "referral claims API failure",
      respond: (status, body) => json(body, status),
    });
  }
}
async function referralAccount(
  request: Request,
  deps: ReferralClaimsDependencies,
): Promise<Response> {
  const actor = await deps.sessionActor(request);
  if (!actor) return json({ error: "sign_in_required" }, 401);
  const cache = await deps.db
    .prepare(
      "SELECT body,observed_at,error_at FROM referral_claim_cache WHERE id='program'",
    )
    .first<ClaimCacheRow>();
  if (!cache) return json({ enabled: false });
  const latest = await deps.db
    .prepare(
      "SELECT body FROM referral_accrual_files ORDER BY epoch DESC LIMIT 1",
    )
    .first<{ body: string }>();
  const referrer = latest
    ? (JSON.parse(latest.body).referrers as FileReferrer[]).find(
        (r) => r.githubId === actor.githubId,
      )
    : undefined;
  const pin = await deps.db
    .prepare(
      "SELECT wallet FROM referral_claim_wallets WHERE referrer_github_id=?",
    )
    .bind(actor.githubId)
    .first<{ wallet: string }>();
  const result: ReferralAccount = {
    enabled: true,
    status: "unknown",
    program: null,
    observedAt: cache.observed_at,
    finalizedAt: null,
    wallet: pin?.wallet ?? null,
    accruedBase: referrer?.cumulativeBase ?? "0",
    claimedBase: null,
    claimableBase: null,
    pendingBase: null,
    paused: false,
    ended: false,
    latestVoided: false,
    pendingUntil: null,
    claim: null,
  };
  if (!cache.body) return json(result);
  const snapshot: ClaimSnapshot = JSON.parse(cache.body);
  const now = deps.now().getTime();
  result.program = snapshot.program;
  result.finalizedAt = new Date(snapshot.block.timestamp * 1000).toISOString();
  result.status =
    cache.error_at ||
    now - Date.parse(snapshot.observedAt) > REFERRAL_CACHE_MAX_AGE_MS ||
    now - snapshot.block.timestamp * 1000 > REFERRAL_CACHE_MAX_AGE_MS
      ? "stale"
      : "ready";
  result.paused = snapshot.paused || snapshot.latestPaused;
  result.ended = snapshot.ended;
  result.latestVoided = snapshot.epochs.at(-1)?.voided ?? false;
  const current = activeClaimEpoch(snapshot);
  const pending = snapshot.epochs.at(-1);
  if (
    pending &&
    !pending.voided &&
    pending.epoch !== current?.epoch &&
    !result.paused
  )
    result.pendingUntil = new Date(pending.claimableAt * 1000).toISOString();
  const claimed = BigInt(
    result.wallet ? (snapshot.claimed[result.wallet] ?? "0") : "0",
  );
  let claimable = 0n;
  if (current && result.wallet) {
    const file = await deps.db
      .prepare(
        "SELECT body FROM referral_accrual_files WHERE period=? AND merkle_root=? AND tree_total_base=?",
      )
      .bind(current.period, current.root, current.totalBase)
      .first<{ body: string }>();
    if (!file) throw new Error("Cached referral root has no filed record");
    const record = (JSON.parse(file.body).referrers as FileReferrer[]).find(
      (r) => r.githubId === actor.githubId && r.wallet === result.wallet,
    );
    if (record?.leaf) {
      const cumulative = BigInt(record.cumulativeBase);
      if (cumulative > claimed) {
        claimable = cumulative - claimed;
        result.claim = {
          period: current.period,
          epoch: current.epoch,
          root: current.root,
          cumulativeBase: record.cumulativeBase,
          proof: record.leaf.proof,
        } as ReferralClaim;
      }
    }
  }
  const accrued = BigInt(result.accruedBase);
  if (claimed + claimable > accrued)
    throw new Error("Referral claim totals differ");
  result.claimedBase = claimed.toString();
  result.claimableBase = claimable.toString();
  result.pendingBase = (accrued - claimed - claimable).toString();
  return json(referralResponse(result));
}
