import { fail } from "../http";
import type { SecurityApiDependencies } from "./case-store";

/**
 * Rolling admission precedes object writes and paid calls, including
 * retries. One actor gets ten admissions per rolling hour, counting both
 * intake admissions and intake submissions received in the window, so a
 * manual case claim shares the same budget as automatic intake work.
 */
export async function admitPublicWork(
  deps: Pick<SecurityApiDependencies, "db" | "now" | "randomId">,
  actorId: string,
  id = `iw_${deps.randomId().replaceAll("-", "")}`,
) {
  const now = deps.now().getTime();
  const cutoff = now - 3_600_000;
  const result = await deps.db.batch([
    deps.db
      .prepare(
        "DELETE FROM security_intake_rate_admissions WHERE actor_github_id=? AND admitted_at<=?",
      )
      .bind(actorId, cutoff),
    deps.db
      .prepare(
        "INSERT INTO security_intake_rate_admissions(id,actor_github_id,admitted_at) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM security_intake_rate_admissions WHERE actor_github_id=?) + (SELECT COUNT(*) FROM security_submission_intake i JOIN security_submissions s ON s.id=i.submission_id WHERE s.reporter_github_id=? AND i.received_at>? AND NOT EXISTS(SELECT 1 FROM security_intake_rate_admissions a WHERE a.id=i.submission_id)) < 10",
      )
      .bind(id, actorId, now, actorId, actorId, new Date(cutoff).toISOString()),
  ]);
  if (result[1].meta?.changes !== 1)
    fail(
      429,
      "intake_rate_limited",
      "Please wait before requesting more private report work.",
    );
}
