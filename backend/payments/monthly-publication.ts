/** Publish final signed execution inputs from the scheduled attester (PRD 6).
 * No signing, RPC, or payment submission occurs in the public read route.
 */

import { EvmMonthlyAlreadyAdmitted } from "../../contracts/evm/adapter";
import {
  type MonthlySchedule,
  monthlyCutoff,
  periodEnd,
} from "../../src/lib/payments/monthly-allocation";
import type { MonthlyAuthorization } from "../../workers/payment-executor/monthly";
import type { D1TransactionalDatabase } from "../d1";
import { automaticMonthlyPayment } from "./monthly";
import type { MonthlyAttestationRequest } from "./monthly-attestation";

export async function publishMonthlyAuthorizations(deps: {
  db: D1TransactionalDatabase;
  networks: readonly string[];
  schedule: MonthlySchedule;
  now: Date;
  authorize(request: MonthlyAttestationRequest): Promise<MonthlyAuthorization>;
}) {
  // Revisit legacy EVM publications too: a reviewed upgrade may make their
  // all-at-once allocation executable through V2. The original row stays fixed.
  const candidates = await deps.db
    .prepare(
      "SELECT json_group_array(json_object('projectId',r.project_id,'period',r.period,'network',r.network,'snapshotSha256',r.snapshot_sha256)) items FROM monthly_payment_runs r LEFT JOIN monthly_payment_authorizations a ON a.project_id=r.project_id AND a.period=r.period AND a.network=r.network WHERE r.obligations_created_at IS NOT NULL AND EXISTS(SELECT 1 FROM monthly_payment_obligations o WHERE o.project_id=r.project_id AND o.period=r.period) AND (a.authorization IS NULL OR json_extract(a.authorization,'$.plan.family')='evm')",
    )
    .first<{ items: string }>();
  const published: string[] = [];
  const failures: unknown[] = [];
  for (const request of JSON.parse(
    candidates?.items ?? "[]",
  ) as MonthlyAttestationRequest[]) {
    if (
      !deps.networks.includes(request.network) ||
      !(await automaticMonthlyPayment(deps.db, request.projectId))
    )
      continue;
    const cutoff = monthlyCutoff(deps.schedule, request.period);
    const closes = monthlyCutoff(
      deps.schedule,
      periodEnd(request.period).toISOString().slice(0, 7),
    );
    if (!cutoff || !closes || deps.now < cutoff || deps.now >= closes) continue;
    try {
      const signed = await deps.authorize(request);
      const authorization: MonthlyAuthorization = {
        plan: signed.plan,
        signatureHex: signed.signatureHex,
      };
      if (
        Object.entries(request).some(
          ([key, value]) =>
            authorization.plan.request[
              key as keyof MonthlyAttestationRequest
            ] !== value,
        )
      )
        throw new Error("Attester returned another monthly allocation");
      const attempt = authorization.plan.evmReservation;
      if (
        attempt &&
        (attempt.version !== 2 ||
          attempt.allocationDigest !== `0x${request.snapshotSha256}` ||
          attempt.wholeGross !== authorization.plan.totalGrossBase ||
          !/^(0|[1-9][0-9]{0,77})$/.test(attempt.sourceSequence))
      )
        throw new Error(
          "Attester returned an invalid monthly execution attempt",
        );
      if (attempt) {
        const first = await deps.db
          .prepare(
            "SELECT authorization FROM monthly_payment_authorizations WHERE project_id=? AND period=? AND network=?",
          )
          .bind(request.projectId, request.period, request.network)
          .first<{ authorization: string }>();
        if (first) {
          const legacy = JSON.parse(
            first.authorization,
          ) as MonthlyAuthorization;
          if (!legacy.plan.evmReservation)
            authorization.legacyAuthorization = {
              plan: legacy.plan,
              signatureHex: legacy.signatureHex,
            };
        }
      }
      const text = JSON.stringify(authorization);
      const previous = await readMonthlyAuthorization(
        deps.db,
        request.projectId,
        request.period,
        request.network,
      );
      if (previous?.authorization === text) continue;
      await deps.db
        .prepare(
          "INSERT INTO monthly_payment_authorizations(project_id,period,network,snapshot_sha256,authorization,published_at) SELECT project_id,period,network,snapshot_sha256,?,? FROM monthly_payment_runs WHERE project_id=? AND period=? AND network=? AND snapshot_sha256=? AND obligations_created_at IS NOT NULL ON CONFLICT DO NOTHING",
        )
        .bind(
          text,
          deps.now.toISOString(),
          request.projectId,
          request.period,
          request.network,
          request.snapshotSha256,
        )
        .run();
      if (attempt)
        await deps.db
          .prepare(
            "INSERT INTO monthly_payment_authorization_attempts(project_id,period,network,source_sequence,authorization,published_at) SELECT project_id,period,network,?,?,? FROM monthly_payment_authorizations a WHERE project_id=? AND period=? AND network=? AND snapshot_sha256=? AND NOT EXISTS(SELECT 1 FROM monthly_payment_authorization_attempts n WHERE n.project_id=a.project_id AND n.period=a.period AND n.network=a.network AND (length(n.source_sequence)>length(?) OR (length(n.source_sequence)=length(?) AND n.source_sequence>?))) ON CONFLICT DO NOTHING",
          )
          .bind(
            attempt.sourceSequence,
            text,
            deps.now.toISOString(),
            request.projectId,
            request.period,
            request.network,
            request.snapshotSha256,
            attempt.sourceSequence,
            attempt.sourceSequence,
            attempt.sourceSequence,
          )
          .run();
      const saved = await readMonthlyAuthorization(
        deps.db,
        request.projectId,
        request.period,
        request.network,
      );
      if (saved?.authorization !== text)
        throw new Error("Monthly authorization publication conflict");
      published.push(
        `${request.projectId}/${request.period}/${request.network}`,
      );
    } catch (error) {
      // The same finalized block proves admission and the source sequence.
      // Keep the latest published attempt so permissionless callers can resume.
      if (error instanceof EvmMonthlyAlreadyAdmitted) continue;
      failures.push(error);
    }
  }
  return { published, failures };
}

export function readMonthlyAuthorization(
  db: D1TransactionalDatabase,
  projectId: string,
  period: string,
  network: string,
) {
  return db
    .prepare(
      "SELECT authorization,published_at FROM monthly_payment_current_authorizations WHERE project_id=? AND period=? AND network=?",
    )
    .bind(projectId, period, network)
    .first<{ authorization: string; published_at: string }>();
}
