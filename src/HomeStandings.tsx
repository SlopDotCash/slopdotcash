import { ArrowDown } from "lucide-react";
import { useCallback, useMemo } from "react";
import { Link } from "./Link";
import { fetchWithDeadline, readBoundedJson } from "./lib/browser-json";
import { isPointsSummary, type PointsSummary } from "./lib/points-summary";
import { usePublicResource } from "./lib/use-public-resource";

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

/** The home table ranks all-time points from the small build summary. */
export function HomeStandings() {
  const loadPoints = useCallback(loadSummary, []);
  const [points, retryPoints] = usePublicResource(
    true,
    loadPoints,
    "Points summary unavailable",
  );
  const ranked = useMemo(() => {
    if (points.status !== "ready") return [];
    return [...points.summary.contributors].sort(
      (a, b) => b.total - a.total || a.actor.id.localeCompare(b.actor.id),
    );
  }, [points]);
  const ranks = new Map<string, number>();
  let previous: number | null = null;
  ranked.forEach((row, index) => {
    const value = row.total;
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
                  <th aria-sort="descending" scope="col">
                    <span className="points-sort">
                      Points <ArrowDown aria-hidden="true" size={14} />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ranked.slice(0, HOME_ROWS).map((row) => (
                  <tr key={row.actor.id}>
                    <td className="points-rank">{ranks.get(row.actor.id)}</td>
                    <td>
                      <Link
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
                      </Link>
                    </td>
                    <td className="points-value">
                      {`${row.total.toLocaleString("en-US")} pts`}
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
