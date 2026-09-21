import { useEffect, useState } from "react";
import { readBoundedJson } from "./lib/browser-json";
import type { CycleIndex } from "./lib/cycle-index";
import {
  assertProfiles,
  type ProfileIndex,
  profileCounts,
} from "./lib/profiles";

const disclosures = import.meta.glob("../disclosures/*.json", {
  eager: true,
  import: "default",
}) as Record<
  string,
  {
    rows: {
      actorId: string;
      state: string;
      observed: null | { amountMinor: string; signature: string };
    }[];
  }
>;
type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; index: ProfileIndex };
export function useProfiles() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries the census request.
  useEffect(() => {
    const c = new AbortController();
    setState({ status: "loading" });
    void fetch("/data/profiles.json", { signal: c.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw Error("Profiles unavailable");
        const v = await readBoundedJson(r, 8 * 1024 * 1024, "profiles");
        assertProfiles(v);
        if (!c.signal.aborted) setState({ status: "ready", index: v });
      })
      .catch(() => {
        if (!c.signal.aborted) setState({ status: "error" });
      });
    return () => c.abort();
  }, [attempt]);
  return { state, retry: () => setAttempt((n) => n + 1) };
}
function dollars(n: bigint) {
  return `$${(n / 1000000n).toLocaleString("en-US")}.${(n % 1000000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(2, "0")}`;
}
export function ProfileActivity({
  login,
  actorId,
  showIdentity = false,
  cycles,
  census,
}: {
  login: string;
  actorId?: string;
  showIdentity?: boolean;
  cycles?: CycleIndex;
  census: ReturnType<typeof useProfiles>;
}) {
  const { state, retry } = census;
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const matches =
    state.status === "ready"
      ? state.index.people.filter((p) =>
          actorId
            ? p.id === actorId
            : p.login.toLowerCase() === login.toLowerCase(),
        )
      : [];
  const p = matches.length === 1 ? matches[0] : undefined;
  const id = actorId ?? p?.id;
  const counts = p
    ? profileCounts(p)
    : id && state.status === "ready"
      ? { merged: 0, open: 0, closed: 0 }
      : null;
  const image =
    p?.avatarUrl ??
    `https://avatars.githubusercontent.com/${encodeURIComponent(login)}?size=160`;
  const payments =
    cycles && id
      ? cycles.cycles.flatMap((c) =>
          c.contributors
            .filter((m) => m.actor.id === id && m.state === "paid")
            .map((m) => ({
              amount: BigInt(m.paidMinor),
              href: `/cycles/${c.projectId}/${c.cycleId}`,
              name: `${c.projectId} · ${c.cycleId}`,
            })),
        )
      : null;
  const seen = new Set<string>();
  const direct = id
    ? Object.entries(disclosures).flatMap(([path, d]) =>
        d.rows
          .filter(
            (r) => r.actorId === id && r.state === "paid-direct" && r.observed,
          )
          .flatMap((r) => {
            const o = r.observed;
            if (
              !o ||
              !/^\d+$/.test(o.amountMinor) ||
              !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(o.signature) ||
              seen.has(o.signature)
            )
              return [];
            seen.add(o.signature);
            return [
              {
                amount: BigInt(o.amountMinor),
                href: `https://solscan.io/tx/${o.signature}`,
                name: path.split("/").pop()!,
              },
            ];
          }),
      )
    : [];
  return (
    <section className="profile-activity" aria-label="Contributor profile">
      {showIdentity ? (
        <div className="profile-hero">
          {failedImage === image ? (
            <span className="avatar avatar-large" aria-hidden="true">
              {login.slice(0, 2).toUpperCase()}
            </span>
          ) : (
            <img
              className="avatar avatar-large"
              src={image}
              alt=""
              width={80}
              height={80}
              onError={() => setFailedImage(image)}
            />
          )}
          <div className="profile-identity">
            <h1>{p?.login ?? login}</h1>
            <a
              href={`https://github.com/${encodeURIComponent(p?.login ?? login)}`}
              target="_blank"
              rel="noreferrer"
            >
              GitHub · @{p?.login ?? login}
            </a>
          </div>
        </div>
      ) : null}
      <h2>Contribution record</h2>
      {state.status === "error" ? (
        <p role="status">
          PR counts are unavailable.{" "}
          <button type="button" onClick={retry}>
            Retry profile
          </button>
        </p>
      ) : state.status === "loading" ? (
        <p role="status">Loading PR history…</p>
      ) : (
        <>
          <div className="profile-totals">
            {(
              [
                ["Merged", "merged"],
                ["Open", "open"],
                ["Closed without merging", "closed"],
              ] as const
            ).map(([label, key]) => (
              <div key={key}>
                <strong>
                  {counts ? counts[key].toLocaleString() : "Unknown"}
                </strong>
                <span>PRs {label.toLowerCase()}</span>
              </div>
            ))}
          </div>
          <p className="points-meta">
            Slop repository history · updated{" "}
            {new Date(state.index.generatedAt).toLocaleString()}
            {Date.now() - Date.parse(state.index.generatedAt) > 8 * 3600000
              ? " · Stale: refresh pending"
              : ""}
          </p>
          {p ? (
            <details>
              <summary>PR counts by repository</summary>
              <p className="points-meta">
                Statuses observed between{" "}
                {new Date(state.index.startedAt).toLocaleString()} and{" "}
                {new Date(state.index.generatedAt).toLocaleString()}.
              </p>
              <ul>
                {p.repositories.map((r) => (
                  <li key={r.repository}>
                    <a
                      href={`https://github.com/${r.repository}/pulls?q=${encodeURIComponent(`is:pr author:${p.login}`)}`}
                    >
                      {r.repository}
                    </a>{" "}
                    · {r.merged} merged · {r.open} open · {r.closed} closed
                    without merging
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
      <div className="profile-totals">
        <div>
          <strong>
            {payments
              ? dollars(payments.reduce((n, r) => n + r.amount, 0n))
              : "Unavailable"}
          </strong>
          <span>verified payments received · USDC</span>
        </div>
        <div>
          <strong>
            {id
              ? dollars(direct.reduce((n, r) => n + r.amount, 0n))
              : "Unavailable"}
          </strong>
          <span>direct payments reported · USDC</span>
        </div>
      </div>
      <p className="points-meta">
        Direct payments come from published disclosures outside Slop’s verified
        settlement process.
      </p>
      {payments?.length || direct.length ? (
        <details>
          <summary>Payment records</summary>
          <ul>
            {[...(payments ?? []), ...direct].map((r) => (
              <li key={r.href}>
                <a href={r.href} target="_blank" rel="noreferrer">
                  {dollars(r.amount)} USDC · {r.name}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
export function ContributorDirectory() {
  const { state, retry } = useProfiles();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const people =
    state.status === "ready"
      ? state.index.people
          .filter((p) => p.login.toLowerCase().includes(query.toLowerCase()))
          .sort((a, b) => a.login.localeCompare(b.login))
      : [];
  return (
    <section className="points-panel" aria-label="Contributor directory">
      <h2>Find a contributor</h2>
      <p>
        Profiles include everyone with a recorded PR, including open and closed
        work.
      </p>
      <label>
        GitHub username{" "}
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
      </label>
      {state.status === "loading" ? (
        <p role="status">Loading contributors…</p>
      ) : state.status === "error" ? (
        <p role="status">
          Directory unavailable.{" "}
          <button type="button" onClick={retry}>
            Retry directory
          </button>
        </p>
      ) : (
        <>
          <p>{people.length.toLocaleString()} contributors</p>
          <ul className="points-people">
            {people.slice(page * 24, (page + 1) * 24).map((p) => (
              <li key={p.id}>
                <a href={`/contributors/${encodeURIComponent(p.login)}`}>
                  {p.login}
                </a>
                <span>{profileCounts(p).merged} merged PRs</span>
              </li>
            ))}
          </ul>
          {people.length === 0 ? (
            <p>No contributors match this username.</p>
          ) : null}
          <div className="points-controls">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((n) => n - 1)}
            >
              Previous contributors
            </button>
            <button
              type="button"
              disabled={(page + 1) * 24 >= people.length}
              onClick={() => setPage((n) => n + 1)}
            >
              Next contributors
            </button>
          </div>
        </>
      )}
    </section>
  );
}
