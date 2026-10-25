import { evmBindingTypedData } from "../../contracts/evm/adapter";
import {
  type SolanaEscrowConfig,
  solanaMintDecimals,
} from "../../contracts/solana/adapter";
import {
  checkSolanaCommitment,
  prepareSolanaCommitment,
} from "../../contracts/solana/commitment";
import {
  checkSolanaFunding,
  prepareSolanaFunding,
  SolanaFundingError,
  type SolanaFundingIntent,
} from "../../contracts/solana/funding";
import {
  checkSolanaMonthlyCommitment,
  prepareSolanaMonthlyCommitment,
  readSolanaMonthlyCommitment,
} from "../../contracts/solana/monthly-commitment";
import { readBoundedJson } from "../../src/lib/browser-json";
import {
  ESCROW_CHAINS,
  ESCROW_NETWORKS,
  EVM_CHAINS,
} from "../../src/lib/escrow-policy.mjs";
import {
  type AccountMonthlyAward,
  type AccountPayment,
  type DirectTransfer,
  type PaymentAsset,
  type PaymentChain,
  type PaymentsAccount,
  VAULT_SNAPSHOT_STALE_MS,
} from "../../src/lib/payments/contracts";
import { parseVaultAmount } from "../../src/lib/payments/vault-amount";
import { isWalletAddress, isWalletChain } from "../../src/lib/wallets";
import { sha256Hex } from "../../workers/identity/crypto";
import type { D1TransactionalDatabase as D1Database } from "../d1";
import {
  type MonthlyCommitmentInput,
  type MonthlyOwnerService,
  MonthlyPaymentError,
} from "./monthly";
import { readMonthlyAuthorization } from "./monthly-publication";
import {
  buildPaymentWalletMessage,
  canonicalEvmSignature,
  verifyEvmBindingSignature,
  verifyPaymentWalletSignature,
} from "./possession";
import { projectVaultSnapshots } from "./vault-snapshots";
import { registerPaymentWallet } from "./wallet-registration";

function isMonthlyCommitmentInput(
  body: unknown,
): body is MonthlyCommitmentInput {
  if (!body || typeof body !== "object") return false;
  const input = body as MonthlyCommitmentInput;
  return (
    typeof input.network === "string" &&
    typeof input.githubUserId === "string" &&
    /^[1-9][0-9]{0,19}$/.test(input.githubUserId) &&
    [input.snapshotSha256, input.manifestSha256].every(
      (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
    )
  );
}

export interface PaymentsDependencies {
  /** The owner's private monthly allocations; absent where they are not served. */
  monthly?: MonthlyOwnerService;
  db: D1Database;
  now?: () => Date;
  /** Additional trusted deployment origins; never sourced from request input. */
  allowedOrigins?: readonly string[];
  /** Trusted numeric GitHub operator allowlist; never request-supplied. */
  operatorIds?: readonly string[];
  /**
   * Reviewed escrow deployments; never request-supplied. A function is called
   * only for a binding request: Pages reads the D1 project registry for its
   * served networks. A failed read refuses the binding.
   */
  paymentDeployments?:
    | readonly PaymentDeploymentIdentity[]
    | (() => Promise<readonly PaymentDeploymentIdentity[]>);
  /** Service binding to the Solana identity attester role; never request-supplied. */
  solanaAttester?: { fetch(request: Request): Promise<Response> };
  /** Private bounty ledger and its separately scoped attester. Only the
   * authenticated reporter's binding request may access this ledger. */
  securityPayments?: {
    db: D1Database;
    solanaAttester?: { fetch(request: Request): Promise<Response> };
  };
  /** Resolve only a reviewed registry vault and an operator-configured RPC. No request URL or signing service. */
  solanaFundingConfig?: (
    projectId: string,
    network: string,
    vault: string,
  ) => Promise<SolanaEscrowConfig>;
  /** Edge cache for public vault snapshot reads (caches.default on Pages). */
  edgeCache?: {
    match(request: Request): Promise<Response | undefined>;
    put(request: Request, response: Response): Promise<void>;
  };
}
/** The payments cron writes snapshots every 5 minutes; one minute keeps reads near it. */
const VAULT_EDGE_CACHE_SECONDS = 60;
export interface PaymentDeploymentIdentity {
  network: string;
  chain: string;
  vault: string;
  chainId?: string;
}
/** The attester must still have this long to submit a binding authorization. */
const BINDING_SUBMISSION_WINDOW_SECONDS = 600;
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
async function directTransfers(
  db: D1Database,
  column: "project_id" | "github_user_id",
  value: string,
): Promise<DirectTransfer[]> {
  const row = await db
    .prepare(
      `SELECT json_group_array(json_object('projectId',project_id,'contributionMonth',contribution_month,'githubUserId',github_user_id,'login',github_login,'network',network,'chain',chain,'recipient',recipient,'amountMicro',amount_micro,'transactionId',transaction_id,'blockTime',block_time)) items FROM (SELECT * FROM payment_direct_transfers WHERE ${column}=? ORDER BY block_time,transaction_id)`,
    )
    .bind(value)
    .first<{ items: string }>();
  return JSON.parse(row?.items ?? "[]") as DirectTransfer[];
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
    const fundingRoute =
      /^\/projects\/([a-z0-9][a-z0-9-]*)\/solana-funding$/.exec(path);
    if (fundingRoute && request.method === "POST") {
      if (!deps.solanaFundingConfig)
        return json(503, { error: "funding_unavailable" });
      const body = (await readBoundedJson(
        request,
        4096,
        "vault funding action",
      )) as Record<string, unknown>;
      if (
        !body ||
        (body.step !== "review" && body.step !== "check") ||
        (body.operation !== "deposit" && body.operation !== "withdraw") ||
        typeof body.network !== "string" ||
        typeof body.vault !== "string" ||
        typeof body.wallet !== "string" ||
        !isWalletAddress("solana", body.wallet) ||
        (body.step === "review" &&
          (typeof body.amount !== "string" || body.amount.length > 80)) ||
        (body.step === "check" &&
          (typeof body.gross !== "string" ||
            !/^[1-9][0-9]{0,19}$/.test(body.gross))) ||
        (body.step === "check" &&
          (typeof body.blockhash !== "string" ||
            !isWalletAddress("solana", body.blockhash) ||
            typeof body.transactionId !== "string" ||
            body.transactionId.length > 100))
      )
        return json(400, { error: "invalid_funding_action" });
      const config = await deps.solanaFundingConfig(
        fundingRoute[1],
        body.network,
        body.vault,
      );
      let gross = body.gross as string;
      if (body.step === "review") {
        const decimals = await solanaMintDecimals(config, config.mint);
        try {
          gross = parseVaultAmount(body.amount as string, decimals).toString();
        } catch {
          return json(422, {
            error: "invalid_funding_amount",
            message:
              "Enter a positive amount within this token's decimal precision and vault limit.",
          });
        }
      }
      const intent: Omit<SolanaFundingIntent, "blockhash"> = {
        operation: body.operation,
        wallet: body.wallet,
        gross,
      };
      try {
        if (body.step === "review")
          return json(200, {
            plan: await prepareSolanaFunding(config, intent),
          });
        return json(200, {
          status: await checkSolanaFunding(
            config,
            { ...intent, blockhash: body.blockhash as string },
            body.transactionId as string,
          ),
        });
      } catch (error) {
        if (error instanceof SolanaFundingError)
          return json(422, {
            error: "funding_action_rejected",
            message: error.message,
          });
        throw error;
      }
    }
    const monthlySettingRoute =
      /^\/projects\/([a-z0-9][a-z0-9-]*)\/solana-monthly-commitment$/.exec(
        path,
      );
    if (monthlySettingRoute && request.method === "POST") {
      if (!deps.solanaFundingConfig)
        return json(503, { error: "funding_unavailable" });
      const body = (await readBoundedJson(
        request,
        4096,
        "monthly commitment setting",
      )) as Record<string, unknown>;
      if (
        !body ||
        (body.step !== "read" &&
          body.step !== "review" &&
          body.step !== "check") ||
        typeof body.network !== "string" ||
        typeof body.vault !== "string" ||
        (body.step !== "read" &&
          (typeof body.wallet !== "string" ||
            !isWalletAddress("solana", body.wallet) ||
            typeof body.cap !== "string" ||
            !/^(0|[1-9][0-9]{0,19})$/.test(body.cap) ||
            typeof body.enabled !== "boolean")) ||
        (body.step === "check" &&
          (typeof body.blockhash !== "string" ||
            !isWalletAddress("solana", body.blockhash) ||
            typeof body.transactionId !== "string" ||
            body.transactionId.length > 100))
      )
        return json(400, { error: "invalid_monthly_setting" });
      const config = await deps.solanaFundingConfig(
        monthlySettingRoute[1],
        body.network,
        body.vault,
      );
      try {
        if (body.step === "read")
          return json(200, {
            setting: await readSolanaMonthlyCommitment(config),
          });
        const intent = {
          wallet: body.wallet as string,
          cap: body.cap as string,
          enabled: body.enabled as boolean,
        };
        if (body.step === "review")
          return json(200, {
            plan: await prepareSolanaMonthlyCommitment(config, intent),
          });
        return json(200, {
          status: await checkSolanaMonthlyCommitment(
            config,
            { ...intent, blockhash: body.blockhash as string },
            body.transactionId as string,
          ),
        });
      } catch (error) {
        if (error instanceof SolanaFundingError)
          return json(422, {
            error: "monthly_setting_rejected",
            message: error.message,
          });
        throw error;
      }
    }
    const authorizationRoute =
      /^\/projects\/([a-z0-9][a-z0-9-]*)\/monthly\/(\d{4}-(?:0[1-9]|1[0-2]))\/authorization\/([a-z0-9-]+)$/.exec(
        path,
      );
    if (authorizationRoute && request.method === "GET") {
      const [, projectId, period, network] = authorizationRoute;
      const saved = await readMonthlyAuthorization(
        deps.db,
        projectId,
        period,
        network,
      );
      return saved
        ? json(200, {
            authorization: JSON.parse(saved.authorization),
            publishedAt: saved.published_at,
          })
        : json(404, { error: "monthly_authorization_unavailable" });
    }
    const totalsRoute = /^\/projects\/([a-z0-9][a-z0-9-]*)\/totals$/.exec(path);
    if (totalsRoute && request.method === "GET") {
      const projectId = totalsRoute[1];
      // Indexed award totals, one row per network and asset. Amounts are
      // base units of that asset and are never summed across assets.
      const rows = JSON.parse(
        (
          await deps.db
            .prepare(
              "SELECT json_group_array(json_object('network',network,'assetAddress',asset_address,'assetDecimals',asset_decimals,'gross',gross_base,'fee',fee_base,'state',state)) items FROM (SELECT * FROM payment_obligations WHERE project_id=? ORDER BY network,asset_address)",
            )
            .bind(projectId)
            .first<{ items: string }>()
        )?.items ?? "[]",
      ) as (PaymentAsset & { gross: string; fee: string; state: string })[];
      const cursor = await deps.db
        .prepare(
          "SELECT network,position,synced_at FROM payment_chain_cursors WHERE project_id=?",
        )
        .bind(projectId)
        .first<{ network: string; position: string; synced_at: string }>();
      if (!rows.length && !cursor)
        return json(503, { error: "project_payments_not_indexed" });
      const assets = new Map<
        string,
        PaymentAsset & {
          paidNet: bigint;
          paidFee: bigint;
          reservedNet: bigint;
          reservedFee: bigint;
        }
      >();
      for (const r of rows) {
        const key = `${r.network}\u0000${r.assetAddress}`;
        const total = assets.get(key) ?? {
          network: r.network,
          assetAddress: r.assetAddress,
          assetDecimals: r.assetDecimals,
          paidNet: 0n,
          paidFee: 0n,
          reservedNet: 0n,
          reservedFee: 0n,
        };
        const fee = BigInt(r.fee);
        const net = BigInt(r.gross) - fee;
        if (r.state === "paid") {
          total.paidNet += net;
          total.paidFee += fee;
        } else {
          total.reservedNet += net;
          total.reservedFee += fee;
        }
        assets.set(key, total);
      }
      return json(200, {
        projectId,
        network: cursor?.network ?? rows[0].network,
        assets: [...assets.values()].map(
          ({ paidNet, paidFee, reservedNet, reservedFee, ...asset }) => ({
            ...asset,
            totalNetPaidBase: paidNet.toString(),
            payoutFeesPaidBase: paidFee.toString(),
            reservedNetBase: reservedNet.toString(),
            reservedFeeBase: reservedFee.toString(),
          }),
        ),
        coverage: {
          kind: "finalized-payment-events",
          completeThrough: cursor?.position ?? null,
        },
        syncedAt: cursor?.synced_at ?? null,
      });
    }
    // Vault counters cached by the payments worker from finalized reads. A
    // page view never reaches a chain RPC; the edge cache keeps D1 reads low.
    const vaultRoute = /^\/projects\/([a-z0-9][a-z0-9-]*)\/vault$/.exec(path);
    if (vaultRoute && request.method === "GET") {
      const key = new Request(url.toString(), { method: "GET" });
      const cached = await deps.edgeCache?.match(key);
      if (cached) return cached;
      const snapshots = await projectVaultSnapshots(deps.db, vaultRoute[1]);
      const response = new Response(
        JSON.stringify({
          projectId: vaultRoute[1],
          snapshots,
          staleAfterMs: VAULT_SNAPSHOT_STALE_MS,
          servedAt: now,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": `public, max-age=${VAULT_EDGE_CACHE_SECONDS}, s-maxage=${VAULT_EDGE_CACHE_SECONDS}`,
            "x-content-type-options": "nosniff",
          },
        },
      );
      await deps.edgeCache?.put(key, response.clone());
      return response;
    }
    const directRoute =
      /^\/(?:projects\/([a-z0-9][a-z0-9-]*)|actors\/([1-9]\d{0,15}))\/direct-transfers$/.exec(
        path,
      );
    if (directRoute && request.method === "GET") {
      const transfers = await directTransfers(
        deps.db,
        directRoute[2] ? "github_user_id" : "project_id",
        directRoute[2] ?? directRoute[1],
      );
      return json(200, {
        transfers,
        totalMicro: transfers
          .reduce((sum, t) => sum + BigInt(t.amountMicro), 0n)
          .toString(),
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
    const solanaCommitmentRoute =
      /^\/projects\/([a-z0-9][a-z0-9-]*)\/monthly\/(\d{4}-(?:0[1-9]|1[0-2]))\/solana-commitment$/.exec(
        path,
      );
    if (solanaCommitmentRoute && request.method === "POST") {
      if (!deps.solanaFundingConfig)
        return json(503, { error: "owner_commitment_unavailable" });
      const body = (await readBoundedJson(
        request,
        4096,
        "Solana award commitment",
      )) as Record<string, unknown>;
      if (
        !body ||
        (body.step !== "review" && body.step !== "check") ||
        typeof body.network !== "string" ||
        typeof body.vault !== "string" ||
        typeof body.wallet !== "string" ||
        !isWalletAddress("solana", body.wallet)
      )
        return json(400, { error: "invalid_commitment_action" });
      try {
        if (body.step === "review") {
          if (!isMonthlyCommitmentInput(body))
            return json(400, { error: "invalid_commitment_review" });
          if (!deps.monthly)
            return json(503, { error: "owner_commitment_unavailable" });
          const award = await deps.monthly.commitment(
            solanaCommitmentRoute[1],
            solanaCommitmentRoute[2],
            { githubId: member.github_id, githubLogin: member.login },
            body,
          );
          if (
            award.deployment.vault !== body.vault ||
            ESCROW_NETWORKS[award.deployment.network].family !== "solana"
          )
            return json(409, { error: "commitment_vault_changed" });
          const config = await deps.solanaFundingConfig(
            solanaCommitmentRoute[1],
            body.network,
            body.vault,
          );
          const reviewed = award.deployment;
          if (
            config.mint !== reviewed.asset ||
            [
              "network",
              "vault",
              "programId",
              "projectPda",
              "owner",
              "identityAuthority",
              "feeRecipient",
              "rotationAuthority",
              "codeSha256",
              "upgradeAuthority",
              "networkDomain",
              "bindingDelaySeconds",
              "rotationDelaySeconds",
            ].some(
              (key) =>
                (config as unknown as Record<string, unknown>)[key] !==
                (reviewed as unknown as Record<string, unknown>)[key],
            )
          )
            return json(409, {
              error: "commitment_vault_changed",
              message:
                "The vault changed during review. Reload its current awards.",
            });
          const transaction = await prepareSolanaCommitment(config, {
            wallet: body.wallet,
            sourceDigest: award.award.sourceDigest,
            githubUserId: award.award.githubUserId,
            gross: award.award.gross,
          });
          return json(200, { plan: award, transaction });
        }
        // Recovery reads finalized evidence only. A later hold or review outage must
        // not hide a transaction already submitted by the owner's wallet.
        if (
          typeof body.sourceDigest !== "string" ||
          !/^[a-f0-9]{64}$/.test(body.sourceDigest) ||
          typeof body.githubUserId !== "string" ||
          !/^[1-9][0-9]{0,19}$/.test(body.githubUserId) ||
          typeof body.gross !== "string" ||
          !/^[1-9][0-9]{0,19}$/.test(body.gross) ||
          typeof body.blockhash !== "string" ||
          !isWalletAddress("solana", body.blockhash) ||
          typeof body.transactionId !== "string" ||
          body.transactionId.length > 100
        )
          return json(400, { error: "invalid_commitment_check" });
        const config = await deps.solanaFundingConfig(
          solanaCommitmentRoute[1],
          body.network,
          body.vault,
        );
        return json(200, {
          status: await checkSolanaCommitment(
            config,
            {
              wallet: body.wallet,
              sourceDigest: body.sourceDigest,
              githubUserId: body.githubUserId,
              gross: body.gross,
              blockhash: body.blockhash,
            },
            body.transactionId,
          ),
        });
      } catch (error) {
        if (error instanceof MonthlyPaymentError)
          return json(error.status, {
            error: error.code,
            message: error.message,
          });
        if (error instanceof SolanaFundingError)
          return json(422, {
            error: "commitment_action_rejected",
            message: error.message,
          });
        throw error;
      }
    }
    const monthlyRoute =
      /^\/projects\/([a-z0-9][a-z0-9-]*)\/monthly\/(\d{4}-(?:0[1-9]|1[0-2]))(?:\/(allocations|finalize|commitment))?$/.exec(
        path,
      );
    const monthlySettingsRoute =
      /^\/projects\/([a-z0-9][a-z0-9-]*)\/monthly-settings$/.exec(path);
    if (monthlyRoute || monthlySettingsRoute) {
      if (!deps.monthly)
        return json(503, { error: "monthly_awards_unavailable" });
      const actor = { githubId: member.github_id, githubLogin: member.login };
      const sequence = (value: unknown): value is number =>
        Number.isSafeInteger(value) && (value as number) >= 0;
      try {
        if (monthlySettingsRoute && request.method === "POST") {
          const body = (await readBoundedJson(
            request,
            1024,
            "Monthly payment setting",
          )) as Record<string, unknown>;
          if (typeof body?.automatic !== "boolean")
            return json(400, { error: "invalid_monthly_setting" });
          return json(
            200,
            await deps.monthly.setAutomatic(
              monthlySettingsRoute[1],
              actor,
              body.automatic,
            ),
          );
        }
        if (monthlyRoute && !monthlyRoute[3] && request.method === "GET")
          return json(
            200,
            await deps.monthly.view(monthlyRoute[1], monthlyRoute[2], actor),
          );
        if (monthlyRoute?.[3] && request.method === "POST") {
          const body = (await readBoundedJson(
            request,
            4096,
            "Monthly award action",
          )) as Record<string, unknown>;
          const [, projectId, period, action] = monthlyRoute;
          if (action === "allocations") {
            if (
              typeof body?.githubUserId !== "string" ||
              typeof body.grossBase !== "string" ||
              !sequence(body.expectedSequence)
            )
              return json(400, { error: "invalid_allocation" });
            return json(
              200,
              await deps.monthly.changeAllocation(projectId, period, actor, {
                githubUserId: body.githubUserId,
                grossBase: body.grossBase,
                expectedSequence: body.expectedSequence,
              }),
            );
          }
          if (action === "finalize") {
            if (!sequence(body?.expectedSequence))
              return json(400, { error: "invalid_finalization" });
            return json(
              200,
              await deps.monthly.finalize(
                projectId,
                period,
                actor,
                body.expectedSequence,
              ),
            );
          }
          if (!isMonthlyCommitmentInput(body))
            return json(400, { error: "invalid_commitment_review" });
          return json(
            200,
            await deps.monthly.commitment(projectId, period, actor, body),
          );
        }
      } catch (error) {
        if (error instanceof MonthlyPaymentError)
          return json(error.status, {
            error: error.code,
            message: error.message,
          });
        throw error;
      }
    }
    if (path === "/admin/wallet-proposals" && request.method === "POST") {
      if (!deps.operatorIds?.includes(member.github_id))
        return json(403, { error: "operator_required" });
      const body = (await readBoundedJson(
        request,
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
        request,
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
        request,
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
        request,
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
    // An EVM destination binding needs the destination wallet's EIP-712
    // signature over the exact chain, vault, actor, destination, expected
    // version, claim digest and expiry (PAY-05). The challenge is stateless:
    // the authorize step verifies every field against the current claim, and
    // the chain ID comes from the reviewed deployment, never the request.
    if (
      ["/wallets/bind-challenge", "/wallets/bind-authorize"].includes(path) &&
      request.method === "POST"
    ) {
      const body = (await readBoundedJson(
        request,
        4096,
        "binding authorization",
      )) as Record<string, unknown>;
      const decimal = (value: unknown): value is string =>
        typeof value === "string" && /^(0|[1-9][0-9]{0,18})$/.test(value);
      const authorize = path === "/wallets/bind-authorize";
      if (
        typeof body.claimId !== "string" ||
        typeof body.network !== "string" ||
        typeof body.vault !== "string" ||
        !/^0x[0-9a-fA-F]{40}$/.test(body.vault) ||
        !decimal(body.expectedVersion) ||
        (authorize &&
          (!decimal(body.expiresAt) ||
            typeof body.signature !== "string" ||
            !/^0x[0-9a-fA-F]{130}$/.test(body.signature)))
      )
        return json(400, { error: "invalid_request" });
      let available: readonly PaymentDeploymentIdentity[];
      try {
        if (!deps.paymentDeployments) throw new Error("No deployments");
        available =
          typeof deps.paymentDeployments === "function"
            ? await deps.paymentDeployments()
            : deps.paymentDeployments;
      } catch {
        return json(503, { error: "payment_deployments_unavailable" });
      }
      const vault = body.vault.toLowerCase();
      // A registry network fixes the deployment's chain and chain id, so a
      // Base claim never yields Robinhood Chain consent or the reverse, even
      // when a deployment record is mislabelled. Only the local Anvil chain
      // id (31337) may name a network outside the registry.
      const registered = (d: PaymentDeploymentIdentity) => {
        const policy = Object.hasOwn(ESCROW_NETWORKS, d.network)
          ? ESCROW_NETWORKS[d.network as keyof typeof ESCROW_NETWORKS]
          : undefined;
        return policy
          ? policy.family === "evm" &&
              policy.chain === d.chain &&
              policy.chainId === d.chainId
          : d.chainId === "31337";
      };
      const deployments = available.filter(
        (d) =>
          (EVM_CHAINS as readonly string[]).includes(d.chain) &&
          d.network === body.network &&
          d.vault.toLowerCase() === vault &&
          typeof d.chainId === "string" &&
          /^[1-9][0-9]{0,18}$/.test(d.chainId) &&
          registered(d),
      );
      if (deployments.length !== 1)
        return json(400, { error: "unknown_deployment" });
      const chainId = BigInt(deployments[0].chainId as string);
      const wallet = await deps.db
        .prepare(
          `SELECT w.id,w.wallet_address,w.record_sha256 FROM wallet_claims w JOIN payment_wallet_authorizations a ON a.claim_id=w.id WHERE w.id=? AND w.github_user_id=? AND w.chain=? AND w.source='d1_registry' AND NOT EXISTS(SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id=w.id)`,
        )
        .bind(body.claimId, member.github_id, deployments[0].chain)
        .first<{ id: string; wallet_address: string; record_sha256: string }>();
      if (!wallet) return json(409, { error: "claim_not_current" });
      const nowSeconds = Math.floor(Date.parse(now) / 1000);
      const expiresAt = authorize
        ? (body.expiresAt as string)
        : String(nowSeconds + 90 * 24 * 60 * 60);
      const binding = {
        githubUserId: member.github_id,
        destination: wallet.wallet_address,
        expectedVersion: body.expectedVersion,
        claimDigest: `0x${wallet.record_sha256}`,
        expiresAt,
      };
      if (!authorize)
        return json(200, {
          claimId: wallet.id,
          typedData: evmBindingTypedData(chainId, vault, binding),
        });
      // Only an authorization the attester can still submit is stored.
      if (
        BigInt(expiresAt) <=
        BigInt(nowSeconds + BINDING_SUBMISSION_WINDOW_SECONDS)
      )
        return json(400, { error: "authorization_expires_too_soon" });
      // Store the encoding the vault accepts: a recovery byte of 0 or 1
      // becomes 27 or 28; a high-s signature is refused.
      const signature = canonicalEvmSignature(body.signature as string);
      if (
        !signature ||
        !verifyEvmBindingSignature(chainId, vault, binding, signature)
      )
        return json(403, { error: "wallet_signature_required" });
      // Rows are append-only evidence. A new signature with another expiry is
      // its own row, so an expired authorization never blocks a renewal.
      await deps.db
        .prepare(
          "INSERT INTO payment_binding_authorizations(claim_id,github_user_id,network,vault,chain_id,expected_version,expires_at,signature,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(claim_id,network,vault,chain_id,expected_version,expires_at) DO NOTHING",
        )
        .bind(
          wallet.id,
          member.github_id,
          body.network,
          vault,
          chainId.toString(),
          body.expectedVersion,
          expiresAt,
          signature,
          now,
        )
        .run();
      // An identical earlier row is a signature over the same fields; report
      // success only when a verified row for these exact fields is stored.
      const stored = await deps.db
        .prepare(
          "SELECT signature FROM payment_binding_authorizations WHERE claim_id=? AND github_user_id=? AND network=? AND vault=? AND chain_id=? AND expected_version=? AND expires_at=?",
        )
        .bind(
          wallet.id,
          member.github_id,
          body.network,
          vault,
          chainId.toString(),
          body.expectedVersion,
          expiresAt,
        )
        .first<{ signature: string }>();
      if (
        !stored ||
        !verifyEvmBindingSignature(chainId, vault, binding, stored.signature)
      )
        throw new Error("Binding authorization was not stored");
      return json(200, { authorized: true, expiresAt });
    }
    // A Solana binding transaction must carry the destination wallet's own
    // signature (PAY-05). The attester prepares and half-signs the exact
    // transaction for the contributor's current claim and payout attempt; the
    // contributor's wallet signs the same bytes and returns them here.
    if (
      [
        "/wallets/solana-bind/prepare",
        "/wallets/solana-bind/complete",
      ].includes(path) &&
      request.method === "POST"
    ) {
      const body = (await readBoundedJson(
        request,
        4096,
        "solana binding",
      )) as Record<string, unknown>;
      const complete = path === "/wallets/solana-bind/complete";
      if (
        typeof body.obligationId !== "string" ||
        !/^[0-9a-f]{64}$/.test(body.obligationId) ||
        (complete &&
          (typeof body.transaction !== "string" ||
            body.transaction.length > 2048 ||
            !/^[A-Za-z0-9+/]+={0,2}$/.test(body.transaction)))
      )
        return json(400, { error: "invalid_request" });
      if (!deps.solanaAttester && !deps.securityPayments)
        return json(503, { error: "identity_attester_unavailable" });
      const bindingQuery =
        "SELECT o.id obligationId,o.network,o.vault,o.github_user_id githubUserId,w.id claimId,w.record_sha256 claimDigest,w.wallet_address destination,t.id idempotencyKey FROM payment_obligations o JOIN wallet_claims w ON w.github_user_id=o.github_user_id AND w.chain=o.chain JOIN payment_wallet_authorizations a ON a.claim_id=w.id JOIN payment_attempts t ON t.obligation_id=o.id AND t.claim_id=w.id WHERE o.id=? AND o.github_user_id=? AND o.chain='solana' AND o.state='reserved' AND w.source='d1_registry' AND t.state IN ('prepared','unknown','submitted') AND NOT EXISTS(SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id=w.id) ORDER BY t.created_at LIMIT 1";
      let attester = deps.solanaAttester;
      let payment = await deps.db
        .prepare(bindingQuery)
        .bind(body.obligationId, member.github_id)
        .first<Record<string, string>>();
      if (!payment && deps.securityPayments) {
        const owned = await deps.db
          .prepare(
            "SELECT s.case_id FROM security_settlements s JOIN security_cases c ON c.id=s.case_id WHERE s.obligation_id=? AND c.reporter_github_id=?",
          )
          .bind(body.obligationId, member.github_id)
          .first<{ case_id: string }>();
        if (owned) {
          await deps.db
            .prepare(
              "INSERT INTO security_case_access_log(case_id,actor_github_id,actor_role,action,at) VALUES(?,?,'reporter','write',?)",
            )
            .bind(owned.case_id, member.github_id, now)
            .run();
          payment = await deps.securityPayments.db
            .prepare(bindingQuery)
            .bind(body.obligationId, member.github_id)
            .first<Record<string, string>>();
          attester = deps.securityPayments.solanaAttester;
        }
      }
      if (!payment) return json(409, { error: "binding_not_ready" });
      if (!attester)
        return json(503, { error: "identity_attester_unavailable" });
      const response = await attester.fetch(
        new Request(
          `https://identity-attester.internal/v1/${complete ? "complete-bind" : "pay"}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": payment.idempotencyKey,
            },
            body: JSON.stringify(
              complete
                ? { ...payment, transaction: body.transaction }
                : payment,
            ),
          },
        ),
      );
      if (!response.ok)
        return json(409, { error: "binding_pending_or_rejected" });
      const result = (await response.json()) as {
        transactionId?: unknown;
        transaction?: unknown;
      };
      if (
        typeof result.transactionId !== "string" ||
        (result.transaction !== undefined &&
          typeof result.transaction !== "string")
      )
        throw new Error("Invalid identity attester response");
      return json(200, {
        transactionId: result.transactionId,
        ...(!complete && typeof result.transaction === "string"
          ? { transaction: result.transaction }
          : {}),
      });
    }
    if (path === "/me" && request.method === "GET") {
      const walletRows = await deps.db
        .prepare(
          "SELECT json_group_array(json_object('chain',w.chain,'claimId',w.id,'address',w.wallet_address,'authorized',json(CASE WHEN a.claim_id IS NULL THEN 'false' ELSE 'true' END))) items FROM wallet_claims w LEFT JOIN payment_wallet_authorizations a ON a.claim_id=w.id WHERE w.github_user_id=? AND NOT EXISTS(SELECT 1 FROM wallet_claims n WHERE n.supersedes_claim_id=w.id)",
        )
        .bind(member.github_id)
        .first<{ items: string }>();
      const paymentRows = await deps.db
        .prepare(
          "SELECT json_group_array(json_object('id',o.id,'projectId',project_id,'network',network,'chain',chain,'assetAddress',asset_address,'assetDecimals',asset_decimals,'grossBase',gross_base,'feeBase',fee_base,'state',o.state,'transactionId',paid_transaction,'submittedTransactionId',(SELECT transaction_id FROM payment_attempts a WHERE a.obligation_id=o.id AND a.transaction_id IS NOT NULL ORDER BY created_at DESC LIMIT 1),'deliveryState',CASE WHEN o.state='paid' THEN 'paid' WHEN q.state='submitted' THEN 'submitted' WHEN q.state='held' THEN 'held' WHEN q.state IS NULL THEN 'needs_wallet' ELSE 'ready' END)) items FROM payment_obligations o LEFT JOIN payment_outbox q ON q.obligation_id=o.id WHERE github_user_id=?",
        )
        .bind(member.github_id)
        .first<{ items: string }>();
      const payments = JSON.parse(
        paymentRows?.items ?? "[]",
      ) as AccountPayment[];
      // Frozen monthly awards that the vault has not reserved yet. A reserved
      // award is in `payments` under the same source digest, so it is left
      // out here; the state matches the owner's view (monthly.ts).
      const monthlyRows = await deps.db
        .prepare(
          "SELECT json_group_array(json_object('projectId',project_id,'period',period,'network',network,'assetAddress',asset,'assetDecimals',decimals,'grossBase',gross,'feeBase',fee,'netBase',net,'state',state)) items FROM (SELECT r.project_id,r.period,r.network,json_extract(r.snapshot,'$.asset') asset,COALESCE((SELECT v.asset_decimals FROM vault_snapshots v WHERE v.project_id=r.project_id AND v.network=r.network AND v.vault=r.vault AND lower(v.asset_address)=lower(json_extract(r.snapshot,'$.asset'))),CASE WHEN lower(json_extract(b.manifest,'$.rewardAsset.address'))=lower(json_extract(r.snapshot,'$.asset')) THEN json_extract(b.manifest,'$.rewardAsset.decimals') END) decimals,json_extract(a.value,'$.grossBase') gross,json_extract(a.value,'$.feeBase') fee,json_extract(a.value,'$.netBase') net,CASE WHEN r.obligations_created_at IS NULL THEN 'underfunded' ELSE 'awaiting-reservation' END state FROM monthly_payment_runs r JOIN monthly_reward_bases b ON b.project_id=r.project_id AND b.period=r.period, json_each(r.snapshot,'$.awards') a WHERE json_extract(a.value,'$.githubUserId')=? AND NOT EXISTS(SELECT 1 FROM monthly_payment_exclusions e WHERE e.project_id=r.project_id AND e.period=r.period AND e.source_digest=json_extract(a.value,'$.sourceDigest')) AND NOT EXISTS(SELECT 1 FROM payment_obligations o WHERE o.network=r.network AND o.vault=r.vault AND o.source_digest=json_extract(a.value,'$.sourceDigest')) ORDER BY r.period DESC,r.project_id)",
        )
        .bind(member.github_id)
        .first<{ items: string }>();
      const monthlyAwards = (
        JSON.parse(monthlyRows?.items ?? "[]") as Omit<
          AccountMonthlyAward,
          "chain"
        >[]
      ).map((award) => {
        // Decimals come from the vault reading, else the proposal's verified
        // reward asset, else the network's reference asset list.
        const network =
          ESCROW_NETWORKS[award.network as keyof typeof ESCROW_NETWORKS];
        const assetDecimals =
          award.assetDecimals ??
          network?.assets.find(
            (entry) =>
              entry.address.toLowerCase() === award.assetAddress.toLowerCase(),
          )?.decimals;
        if (!network || !Number.isInteger(assetDecimals))
          throw new Error(`Unreviewed monthly award asset on ${award.network}`);
        return { ...award, assetDecimals, chain: network.chain };
      });
      for (const p of payments)
        p.netBase = (BigInt(p.grossBase) - BigInt(p.feeBase)).toString();
      // One balance per network and asset: assets differ in value and in
      // decimals, so amounts are never summed across them.
      const reservedByNetwork = new Map<
        string,
        PaymentAsset & { chain: PaymentChain; net: bigint }
      >();
      for (const p of payments) {
        const key = `${p.chain}\u0000${p.network}\u0000${p.assetAddress}`;
        const row = reservedByNetwork.get(key) ?? {
          chain: p.chain,
          network: p.network,
          assetAddress: p.assetAddress,
          assetDecimals: p.assetDecimals,
          net: 0n,
        };
        if (p.state === "reserved") row.net += BigInt(p.netBase);
        reservedByNetwork.set(key, row);
      }
      const balances = [...reservedByNetwork.values()]
        .sort(
          (a, b) =>
            ESCROW_CHAINS.indexOf(a.chain) - ESCROW_CHAINS.indexOf(b.chain) ||
            a.network.localeCompare(b.network) ||
            a.assetAddress.localeCompare(b.assetAddress),
        )
        .map(({ net, ...asset }) => ({ ...asset, netBase: net.toString() }));
      const account: PaymentsAccount = {
        githubUserId: member.github_id,
        wallets: JSON.parse(walletRows?.items ?? "[]"),
        payments,
        monthlyAwards,
        balances,
        directTransfers: await directTransfers(
          deps.db,
          "github_user_id",
          member.github_id,
        ),
        walletObservations: JSON.parse(
          (
            await deps.db
              .prepare(
                "SELECT json_group_array(json_object('chain',chain,'address',address,'proofLevel',proof_level,'sourceUrl',source_url,'observedAt',observed_at)) items FROM (SELECT * FROM wallet_observations WHERE github_user_id=? ORDER BY observed_at DESC)",
              )
              .bind(member.github_id)
              .first<{ items: string }>()
          )?.items ?? "[]",
        ),
      };
      return json(200, account);
    }
    return json(404, { error: "not_found" });
  } catch {
    return json(503, { error: "payments_unavailable" });
  }
}
