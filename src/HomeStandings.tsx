import { ArrowDown } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link } from "./Link";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import { githubUserIdFromNodeId } from "./lib/github-actor";
import { isPointsSummary, type PointsSummary } from "./lib/points-summary";
import { useCycleIndex } from "./lib/use-cycle-index";
import { usePublicResource } from "./lib/use-public-resource";
import { useReceivedTotals } from "./lib/use-received-totals";
import { formatDateTime, formatMicroUsdc } from "./Presentation";

const HOME_ROWS = 10;

async function loadSummary(signal: AbortSignal) {
  // Browser and edge caches may serve this build output (public/_headers).
  const response = await fetchWithDeadline("/data/points-summary.json", {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Points summary unavailable");
  const value = await readBoundedJson(response, 4_194_304, "points summary");
  if (!isPointsSummary(value))
    throw new Error("Points summary could not be verified");
  return { summary: value as PointsSummary };
}

/** Payment records name numeric GitHub IDs; journal actors may carry node IDs. */
const actorKey = (id: string) =>
  /^[1-9]\d*$/u.test(id) ? id : (githubUserIdFromNodeId(id) ?? id);

/**
 * The home "Top sloperators" table: all-time points from the small build
 * summary and all-time money received from one edge-cached aggregate. Neither
 * read waits for the full ledger or the points journal.
 */
export function HomeStandings() {
  const [sort, setSort] = useState<"points" | "money">("points");
  const loadPoints = useCallback(loadSummary, []);
  const [points, retryPoints] = usePublicResource(
    true,
    loadPoints,
    "Points summary unavailable",
  );
  const [received, retryReceived] = useReceivedTotals();
  const [cycles, retryCycles] = useCycleIndex(true);
  const moneyReady = received.status === "ready" && cycles.status === "ready";
  const moneyMissing =
    received.status === "loading" || cycles.status === "loading"
      ? "Loading…"
      : "Unavailable";
  const rows = useMemo(() => {
    if (points.status !== "ready") return [];
    const money = new Map<string, bigint>();
    const logins = new Map<string, string>();
    const add = (id: string, login: string | null, amount: bigint) => {
      money.set(id, (money.get(id) ?? 0n) + amount);
      if (login && !logins.has(id)) logins.set(id, login);
    };
    if (received.status === "ready")
      for (const contributor of received.received.contributors)
        add(
          contributor.githubUserId,
          contributor.login,
          BigInt(contributor.usdMicro),
        );
    if (cycles.status === "ready")
      for (const cycle of cycles.cycleIndex.cycles)
        for (const contributor of cycle.contributors) {
          if (BigInt(contributor.paidMinor) > 0n)
            add(
              actorKey(contributor.actor.id),
              contributor.actor.login,
              BigInt(contributor.paidMinor),
            );
        }
    const listed = points.summary.contributors.map((contributor) => {
      const id = actorKey(contributor.actor.id);
      const amount = money.get(id) ?? 0n;
      money.delete(id);
      return {
        actor: contributor.actor,
        points: contributor.total,
        money: moneyReady ? amount : null,
      };
    });
    // Paid contributors without points still rank by money received.
    if (moneyReady)
      for (const [id, amount] of money)
        if (amount > 0n)
          listed.push({
            actor: { id, login: logins.get(id) ?? id },
            points: 0,
            money: amount,
          });
    return listed;
  }, [points, received, cycles, moneyReady]);
  const metric = (row: (typeof rows)[number]) =>
    sort === "points" ? BigInt(row.points) : (row.money ?? -1n);
  const ranked = [...rows].sort((a, b) => {
    const left = metric(a);
    const right = metric(b);
    return (
      (left < right ? 1 : left > right ? -1 : 0) ||
      a.actor.id.localeCompare(b.actor.id)
    );
  });
  const ranks = new Map<string, number>();
  let previous: bigint | null = null;
  ranked.forEach((row, index) => {
    const value = metric(row);
    if (value !== previous) ranks.set(row.actor.id, index + 1);
    else ranks.set(row.actor.id, ranks.get(ranked[index - 1].actor.id) ?? 1);
    previous = value;
  });
  return (
    <section className="points-panel" aria-label="Top sloperators">
      <div className="points-panel-heading">
        <h2>Top sloperators</h2>
        <Link href="/points?period=lifetime">View leaderboard</Link>
      </div>
      <p className="points-meta">All time</p>
      {points.status === "loading" ? (
        <p role="status">Loading top contributors…</p>
      ) : points.status === "error" ? (
        <p role="status">
          <span>Top contributors are unavailable.</span>{" "}
          <button type="button" onClick={retryPoints}>
            Retry
          </button>
        </p>
      ) : null}
      {received.status === "error" || cycles.status === "error" ? (
        <p role="status">
          <span>Payment records unavailable.</span>{" "}
          <button
            type="button"
            onClick={() => {
              if (received.status === "error") retryReceived();
              if (cycles.status === "error") retryCycles();
            }}
          >
            Retry payment records
          </button>
        </p>
      ) : received.status === "ready" && received.refreshError ? (
        <p role="status">
          Money received is from {formatDateTime(received.received.generatedAt)}
          ; the latest refresh failed.{" "}
          <button type="button" onClick={retryReceived}>
            Retry payment records
          </button>
        </p>
      ) : null}
      {points.status === "ready" ? (
        ranked.length === 0 ? (
          <p>No contributors yet.</p>
        ) : (
          <section
            className="points-table"
            aria-label="Contributor standings table"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll all table columns.
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Contributor</th>
                  {(
                    [
                      ["points", "Points"],
                      ["money", "Money received"],
                    ] as const
                  ).map(([key, label]) => (
                    <th
                      aria-sort={sort === key ? "descending" : "none"}
                      key={key}
                      scope="col"
                    >
                      <button
                        className="points-sort"
                        onClick={() => setSort(key)}
                        type="button"
                      >
                        {label}
                        {sort === key ? (
                          <ArrowDown aria-hidden="true" size={14} />
                        ) : null}
                      </button>
                      {key === "money" && !moneyReady ? (
                        <small
                          className="points-column-status"
                          aria-hidden="true"
                        >
                          {moneyMissing}
                        </small>
                      ) : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ranked.slice(0, HOME_ROWS).map((row) => (
                  <tr key={row.actor.id}>
                    <td className="points-rank">{ranks.get(row.actor.id)}</td>
                    <td>
                      <a
                        className="points-person"
                        href={`/contributors/${encodeURIComponent(row.actor.login)}`}
                      >
                        <img
                          alt=""
                          decoding="async"
                          height={40}
                          loading="lazy"
                          onError={(event) => {
                            event.currentTarget.hidden = true;
                          }}
                          src={`https://avatars.githubusercontent.com/${encodeURIComponent(row.actor.login)}?size=80`}
                          width={40}
                        />
                        {row.actor.login}
                      </a>
                    </td>
                    <td className="points-value">
                      {`${row.points.toLocaleString("en-US")} pts`}
                    </td>
                    <td className="points-value">
                      {row.money === null ? (
                        <>
                          <span aria-hidden="true">—</span>
                          <span className="visually-hidden">
                            {moneyMissing}
                          </span>
                        </>
                      ) : (
                        formatMicroUsdc(row.money.toString())
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )
      ) : null}
    </section>
  );
}
