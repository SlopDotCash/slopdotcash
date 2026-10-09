import { readBoundedJson } from "../../src/lib/browser-json";
import type {
  AccountPayment,
  PaymentsAccount,
} from "../../src/lib/payments/contracts";
import { isWalletAddress, isWalletChain } from "../../src/lib/wallets";
import { sha256Hex } from "../../workers/identity/crypto";
import type { D1Database } from "../trace/cloudflare-persistence";
import {
  buildPaymentWalletMessage,
  verifyPaymentWalletSignature,
} from "./possession";
import { registerPaymentWallet } from "./wallet-registration";

export interface PaymentsDependencies {
  db: D1Database;
  now?: () => Date;
  /** Additional trusted deployment origins; never sourced from request input. */
  allowedOrigins?: readonly string[];
  /** Trusted numeric GitHub operator allowlist; never request-supplied. */
  operatorIds?: readonly string[];
}
const origins = new Set([
  "https://slop.cash",
  "https://slop.tech",
  "https://eliza.army",
]);
function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
export async function handlePaymentsApi(
  request: Request,
  deps: PaymentsDependencies,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace("/api/v1/payments", "");
  const now = (deps.now?.() ?? new Date()).toISOString();
  if (
    !new Set([...origins, ...(deps.allowedOrigins ?? [])]).has(url.origin) ||
    (request.method !== "GET" &&
      (request.method !== "POST" ||
        request.headers.get("origin") !== url.origin ||
        request.headers.get("content-type")?.split(";")[0] !==
          "application/json"))
  )
    return json(403, { error: "origin_forbidden" });
  try {
    const totalsRoute = /^\/projects\/([a-z0-9][a-z0-9-]*)\/totals$/.exec(path);
    if (totalsRoute && request.method === "GET") {
      const projectId = totalsRoute[1];
      const result = await deps.db
        .prepare(
          "SELECT json_group_array(json_object('network',network,'gross',gross_micro,'fee',fee_micro,'state',state)) items FROM payment_obligations WHERE project_id=?",
        )
        .bind(projectId)
        .first<{ items: string }>();
      const rows = JSON.parse(result?.items ?? "[]") as {
        network: string;
        gross: string;
        fee: string;
        state: string;
      }[];
      const cursor = await deps.db
        .prepare(
          "SELECT network,position,synced_at FROM payment_chain_cursors WHERE project_id=?",
        )
        .bind(projectId)
        .first<{ network: string; position: string; synced_at: string }>();
      if (!rows.length && !cursor)
        return json(503, { error: "project_payments_not_indexed" });
      const total = (state: string, fee: boolean) =>
        rows
          .filter((r) => r.state === state)
          .reduce(
            (sum, r) =>
              sum + (fee ? BigInt(r.fee) : BigInt(r.gross) - BigInt(r.fee)),
            0n,
          )
          .toString();
      return json(200, {
        projectId,
        network: cursor?.network ?? rows[0].network,
        totalNetPaidMicro: total("paid", false),
        payoutFeesPaidMicro: total("paid", true),
        reservedNetMicro: total("reserved", false),
        reservedFeeMicro: total("reserved", true),
        coverage: {
          kind: "finalized-payment-events",
          completeThrough: cursor?.position ?? null,
        },
        syncedAt: cursor?.synced_at ?? null,
      });
    }
    const token = (request.headers.get("cookie") ?? "")
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("__Host-slop_points="))
      ?.slice("__Host-slop_points=".length);
    if (!token || !/^[A-Za-z0-9_-]{40,128}$/.test(token))
      return json(401, { error: "not_signed_in" });
    const member = await deps.db
      .prepare(
        "SELECT m.github_id,m.login FROM points_members m JOIN points_sessions s ON s.actor_id=m.actor_id WHERE s.token_hash=? AND s.expires_at>?",
      )
      .bind(await sha256Hex(token), now)
      .first<{ github_id: string; login: string }>();
    if (!member) return json(401, { error: "session_expired" });
    if (path === "/admin/wallet-proposals" && request.method === "POST") {
      if (!deps.operatorIds?.includes(member.github_id))
        return json(403, { error: "operator_required" });
      const body = (await readBoundedJson(
        request as unknown as Response,
        4096,
        "wallet proposal",
      )) as Record<string, unknown>;
      if (
        typeof body.githubUserId !== "string" ||
        !/^[1-9]\d*$/.test(body.githubUserId) ||
        !isWalletChain(body.chain) ||
        typeof body.address !== "string" ||
        !isWalletAddress(body.chain, body.address) ||
        typeof body.reason !== "string" ||
        !body.reason.trim()
      )
        return json(400, { error: "invalid_proposal" });
      const id = crypto.randomUUID();
      await deps.db
        .prepare("INSERT INTO payment_wallet_proposals VALUES(?,?,?,?,?,?,?)")
        .bind(
          id,
          body.githubUserId,
          body.chain,
          body.address,
          member.github_id,
          body.reason,
          now,
        )
        .run();
      return json(201, { id, state: "pending_contributor_authorization" });
    }

    if (path === "/wallets/register" && request.method === "POST") {
      const body = (await readBoundedJson(
        request as unknown as Response,
        4096,
        "wallet registration",
      )) as Record<string, unknown>;
      if (
        !isWalletChain(body.chain) ||
        typeof body.address !== "string" ||
        !isWalletAddress(body.chain, body.address)
      )
        return json(400, { error: "invalid_wallet" });
      const result = await registerPaymentWallet(
        deps.db,
        member,
        body.chain,
        body.address,
        now,
      );
      return result.conflict
        ? json(409, { error: "stale_wallet_claim" })
        : json(200, { claimId: result.claimId });
    }
    if (path === "/wallets/challenge" && request.method === "POST") {
      const body = (await readBoundedJson(
        request as unknown as Response,
        4096,
        "wallet challenge",
      )) as Record<string, unknown>;
      if (typeof body.claimId !== "string")
        return json(400, { error: "invalid_request" });
      const wallet = await deps.db
        .prepare(
          "SELECT id,chain,wallet_address,record_sha256 FROM wallet_claims w WHERE id=? AND github_user_id=? AND source='d1_registry' AND NOT EXISTS(SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id=w.id)",
        )
        .bind(body.claimId, member.github_id)
        .first<{
          id: string;
          chain: string;
          wallet_address: string;
          record_sha256: string;
        }>();
      if (!wallet) return json(409, { error: "claim_not_current" });
      const id = crypto.randomUUID();
      const expiresAt = new Date(Date.parse(now) + 15 * 60000).toISOString();
      const message = buildPaymentWalletMessage({
        actorId: member.github_id,
        chain: wallet.chain,
        address: wallet.wallet_address,
        claimId: wallet.id,
        claimDigest: wallet.record_sha256,
        nonce: id,
        expiresAt,
      });
      await deps.db
        .prepare("INSERT INTO payment_wallet_challenges VALUES(?,?,?,?,?,NULL)")
        .bind(id, wallet.id, member.github_id, message, expiresAt)
        .run();
      return json(200, {
        challengeId: id,
        message,
        address: wallet.wallet_address,
        chain: wallet.chain,
        expiresAt,
      });
    }
    if (path === "/wallets/authorize" && request.method === "POST") {
      const body = (await readBoundedJson(
        request as unknown as Response,
        4096,
        "wallet authorization",
      )) as Record<string, unknown>;
      if (
        typeof body.claimId !== "string" ||
        typeof body.challengeId !== "string" ||
        typeof body.signature !== "string"
      )
        return json(400, { error: "invalid_request" });
      const challenge = await deps.db
        .prepare(
          "SELECT c.message,w.chain,w.wallet_address FROM payment_wallet_challenges c JOIN wallet_claims w ON w.id=c.claim_id WHERE c.id=? AND c.claim_id=? AND c.github_user_id=? AND c.expires_at>? AND c.consumed_at IS NULL AND NOT EXISTS(SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id=w.id)",
        )
        .bind(body.challengeId, body.claimId, member.github_id, now)
        .first<{ message: string; chain: string; wallet_address: string }>();
      if (
        !challenge ||
        !verifyPaymentWalletSignature(
          challenge.chain,
          challenge.wallet_address,
          challenge.message,
          body.signature,
        )
      )
        return json(403, { error: "wallet_signature_required" });
      const consumed = await deps.db
        .prepare(
          "UPDATE payment_wallet_challenges SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND expires_at>?",
        )
        .bind(now, body.challengeId, now)
        .run();
      if (consumed.meta?.changes !== 1)
        return json(409, { error: "challenge_consumed" });
      const result = await deps.db.batch([
        deps.db
          .prepare(
            "INSERT INTO payment_wallet_authorizations(claim_id,github_user_id,authorized_at,challenge_id,signature) SELECT id,github_user_id,?,?,? FROM wallet_claims w WHERE id=? AND github_user_id=? AND source='d1_registry' AND NOT EXISTS(SELECT 1 FROM wallet_claims next WHERE next.supersedes_claim_id=w.id) ON CONFLICT(claim_id) DO NOTHING",
          )
          .bind(
            now,
            body.challengeId,
            body.signature,
            body.claimId,
            member.github_id,
          ),
        deps.db
          .prepare(
            "INSERT INTO payment_outbox(obligation_id,state,updated_at) SELECT o.id,'ready',? FROM payment_obligations o JOIN wallet_claims w ON w.github_user_id=o.github_user_id AND w.chain=o.chain JOIN payment_wallet_authorizations a ON a.claim_id=w.id WHERE w.id=? AND w.github_user_id=? AND o.state='reserved' AND NOT EXISTS(SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id=w.id) ON CONFLICT(obligation_id) DO UPDATE SET state='ready',updated_at=excluded.updated_at WHERE payment_outbox.state='held'",
          )
          .bind(now, body.claimId, member.github_id),
      ]);
      if (result.some((r) => !r.success))
        throw new Error("Authorization failed");
      const authorized = await deps.db
        .prepare(
          "SELECT a.claim_id FROM payment_wallet_authorizations a JOIN wallet_claims w ON w.id=a.claim_id WHERE a.claim_id=? AND a.github_user_id=? AND NOT EXISTS(SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id=w.id)",
        )
        .bind(body.claimId, member.github_id)
        .first();
      return authorized
        ? json(200, { authorized: true })
        : json(409, { error: "claim_not_current" });
    }
    if (path === "/me" && request.method === "GET") {
      const walletRows = await deps.db
        .prepare(
          "SELECT json_group_array(json_object('chain',w.chain,'claimId',w.id,'address',w.wallet_address,'authorized',json(CASE WHEN a.claim_id IS NULL THEN 'false' ELSE 'true' END),'activationEligibleAt',CASE WHEN w.supersedes_claim_id IS NOT NULL AND a.authorized_at IS NOT NULL THEN strftime('%Y-%m-%dT%H:%M:%fZ',max(w.created_at,a.authorized_at),'+1 day') ELSE NULL END)) items FROM wallet_claims w LEFT JOIN payment_wallet_authorizations a ON a.claim_id=w.id WHERE w.github_user_id=? AND NOT EXISTS(SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id=w.id)",
        )
        .bind(member.github_id)
        .first<{ items: string }>();
      const paymentRows = await deps.db
        .prepare(
          "SELECT json_group_array(json_object('id',o.id,'projectId',project_id,'network',network,'chain',chain,'grossMicro',gross_micro,'feeMicro',fee_micro,'state',o.state,'transactionId',paid_transaction,'submittedTransactionId',(SELECT transaction_id FROM payment_attempts a WHERE a.obligation_id=o.id AND a.transaction_id IS NOT NULL ORDER BY created_at DESC LIMIT 1),'deliveryState',CASE WHEN o.state='paid' THEN 'paid' WHEN q.state='submitted' THEN 'submitted' WHEN q.state='held' THEN 'held' WHEN q.state IS NULL THEN 'needs_wallet' ELSE 'awaiting_binding' END)) items FROM payment_obligations o LEFT JOIN payment_outbox q ON q.obligation_id=o.id WHERE github_user_id=?",
        )
        .bind(member.github_id)
        .first<{ items: string }>();
      const payments = JSON.parse(
        paymentRows?.items ?? "[]",
      ) as AccountPayment[];
      for (const p of payments)
        p.netMicro = (BigInt(p.grossMicro) - BigInt(p.feeMicro)).toString();
      const balances = (["base", "solana"] as const).map((chain) => ({
        chain,
        netMicro: payments
          .filter((p) => p.chain === chain && p.state === "reserved")
          .reduce((sum, p) => sum + BigInt(p.netMicro), 0n)
          .toString(),
      }));
      const account: PaymentsAccount = {
        githubUserId: member.github_id,
        wallets: JSON.parse(walletRows?.items ?? "[]"),
        payments,
        balances,
      };
      return json(200, account);
    }
    return json(404, { error: "not_found" });
  } catch {
    return json(503, { error: "payments_unavailable" });
  }
}
