import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { readBoundedJson, readBoundedText } from "./lib/browser-json";
import {
  assemblePoints,
  POINTS_NOTICE,
  type PointsIndex,
  type PointsJournal,
  type PointsMember,
  pointMembers,
} from "./lib/points";
import { findProject, PROJECTS } from "./lib/projects.mjs";

const productOrigin = () =>
  ["https://slop.cash", "https://slop.tech", "https://eliza.army"].includes(
    window.location.origin,
  );

interface Membership {
  actor: { id: string; login: string };
  joinedAt: string;
  public: boolean;
  welcome: number;
}
type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; journal: PointsJournal; members: PointsMember[] };
const Context = createContext<{
  state: State;
  me: Membership | null;
  refresh: () => void;
  setMe: (m: Membership | null) => void;
}>({
  state: { status: "loading" },
  me: null,
  refresh: () => {},
  setMe: () => {},
});
async function requestJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`Points request returned ${response.status}`);
  return readBoundedJson(response, 24 * 1024 * 1024, "points");
}
async function loadPoints(signal: AbortSignal) {
  const index = (await requestJson("/data/points.json", {
    signal,
  })) as PointsIndex;
  if (!Array.isArray(index.shards) || index.shards.length !== 16)
    throw new Error("Invalid points index");
  const parts = await Promise.all(
    index.shards.map(async (s, i) => {
      if (s.path !== `/data/points/${i.toString(16)}.json`)
        throw new Error("Invalid points path");
      const r = await fetch(s.path, { signal, cache: "no-store" });
      if (!r.ok) throw new Error("Points shard unavailable");
      return readBoundedText(r, 8 * 1024 * 1024, "points history");
    }),
  );
  return assemblePoints(index, parts);
}
function member(value: unknown): Membership {
  const m = value as Membership;
  if (
    !m ||
    typeof m.actor?.id !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(m.actor.login) ||
    m.welcome !== 5 ||
    typeof m.public !== "boolean" ||
    !Number.isFinite(Date.parse(m.joinedAt))
  )
    throw new Error("Invalid points membership");
  return m;
}
export function PointsProvider({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [me, setMe] = useState<Membership | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void loadPoints(controller.signal)
      .then((value) => {
        setState({
          status: "ready",
          journal: value,
          members: pointMembers(value, new Date().toISOString().slice(0, 7)),
        });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({
            status: "error",
            message:
              "Points are unavailable. Your recorded points have not been reset.",
          });
      });
    if (productOrigin())
      void fetch("/api/v1/points/me", {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (r) => {
          if (r.status === 401) return;
          if (!r.ok) throw new Error("session unavailable");
          const m = await readBoundedJson(r, 16384, "points session");
          if (m) setMe(member(m));
        })
        .catch(() => {
          /* Optional session failure never changes contribution balances. */
        });
    return () => controller.abort();
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !attempt) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    void loadPoints(controller.signal)
      .then((value) => {
        setState({
          status: "ready",
          journal: value,
          members: pointMembers(value, new Date().toISOString().slice(0, 7)),
        });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setState({
            status: "error",
            message: "Points are unavailable. Try again later.",
          });
      });
    return () => controller.abort();
  }, [attempt, enabled]);
  return (
    <Context.Provider
      value={{ state, me, setMe, refresh: () => setAttempt((a) => a + 1) }}
    >
      {children}
    </Context.Provider>
  );
}
export function PointsNav() {
  const { state, me } = useContext(Context);
  const total =
    state.status === "ready" && me
      ? (state.members.find((m) => m.actor.id === me.actor.id)?.total ?? 0) +
        me.welcome
      : null;
  return (
    <a href="/points">
      {total === null ? "Points" : `${total.toLocaleString()} pts`}
    </a>
  );
}
function Notice() {
  const { state, refresh } = useContext(Context);
  if (state.status === "loading") return <p role="status">Loading points…</p>;
  if (state.status === "error")
    return (
      <div role="status">
        <p>{state.message}</p>
        <button type="button" onClick={refresh}>
          Retry points
        </button>
      </div>
    );
  return (
    <p className="points-meta">
      Recorded history · updated{" "}
      {new Date(state.journal.generatedAt).toLocaleString()}
      {Date.now() - Date.parse(state.journal.generatedAt) > 8 * 3600000
        ? " · Stale: the next verified update is pending."
        : ""}
    </p>
  );
}
export function PointsLabel({
  actorId,
  projectId,
}: {
  actorId: string;
  projectId?: string;
}) {
  const { state } = useContext(Context);
  if (state.status !== "ready")
    return (
      <span className="points-meta">
        Points {state.status === "loading" ? "loading…" : "unavailable"}
      </span>
    );
  const m = state.members.find((m) => m.actor.id === actorId);
  const n = projectId
    ? (m?.awards
        .filter((a) => a.projectId === projectId)
        .reduce((s, a) => s + a.amount, 0) ?? 0)
    : (m?.total ?? 0);
  return (
    <a href="/points" className="points-label">
      {n.toLocaleString()} pts
    </a>
  );
}
export function ProfilePoints({ login }: { login: string }) {
  const { state, me } = useContext(Context);
  const [joined, setJoined] = useState<Membership | null>(null);
  const [joinStatus, setJoinStatus] = useState("loading");
  useEffect(() => {
    const c = new AbortController();
    setJoined(null);
    setJoinStatus("loading");
    if (!productOrigin()) {
      setJoinStatus("unavailable");
      return () => c.abort();
    }
    void fetch(`/api/v1/points/member?login=${encodeURIComponent(login)}`, {
      signal: c.signal,
    })
      .then(async (r) => {
        if (r.status === 404) {
          setJoinStatus("absent");
          return;
        }
        if (!r.ok) throw new Error("unavailable");
        const m = await readBoundedJson(r, 16384, "member");
        setJoined(m ? member(m) : null);
        setJoinStatus(m ? "ready" : "absent");
      })
      .catch(() => {
        if (!c.signal.aborted) setJoinStatus("unavailable");
      });
    return () => c.abort();
  }, [login]);
  const own = me?.actor.login.toLowerCase() === login.toLowerCase() ? me : null;
  const named =
    state.status === "ready"
      ? state.members.filter(
          (m) => m.actor.login.toLowerCase() === login.toLowerCase(),
        )
      : [];
  const identity = own ?? joined;
  const m =
    state.status === "ready"
      ? identity
        ? state.members.find((m) => m.actor.id === identity.actor.id)
        : named.length === 1
          ? named[0]
          : undefined
      : undefined;
  const [copied, setCopied] = useState("");
  return (
    <section className="points-panel" aria-label="Slop Points">
      <h2>Slop Points</h2>
      <Notice />
      {state.status === "ready" && (m || identity) ? (
        <>
          <p className="points-total">
            {((m?.total ?? 0) + (identity?.welcome ?? 0)).toLocaleString()}{" "}
            <span>pts</span>
          </p>
          <p>
            {m?.monthly.toLocaleString() ?? "0"} contribution points this month
            {identity ? " · 5 welcome points" : ""}
          </p>
          <p>{m?.badges.join(" · ") ?? "Welcome to Slop"}</p>
          <ul className="points-history">
            {m?.awards.slice(0, 20).map((a) => (
              <li key={a.key}>
                <a href={a.sourceUrl} rel="noreferrer" target="_blank">
                  +{a.amount.toLocaleString()} pts ·{" "}
                  {findProject(a.projectId)?.name} ·{" "}
                  {a.category.replaceAll("-", " ")}
                </a>
                <small>
                  {a.occurredAt.slice(0, 10)}
                  {a.provisional ? " · provisional tier" : ""}
                </small>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(
                  `${window.location.origin}/contributors/${encodeURIComponent(login)}`,
                )
                .then(
                  () => setCopied("Link copied"),
                  () =>
                    setCopied("Copy unavailable. Copy this page’s address."),
                );
            }}
          >
            Copy profile link
          </button>
          <span role="status">{copied}</span>
        </>
      ) : state.status === "ready" ? (
        <p>
          {joinStatus === "loading"
            ? "Looking up membership…"
            : joinStatus === "unavailable"
              ? "Membership is temporarily unavailable."
              : "No recorded points for this account yet. Join to get started."}
        </p>
      ) : null}
      <p>{POINTS_NOTICE}</p>
      <a href="/points">How to earn points</a>
    </section>
  );
}
function JoinPoints() {
  const { me, setMe } = useContext(Context);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [authorization, setAuthorization] = useState<string | null>(null);
  const [publish, setPublish] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function start() {
    active.current?.abort();
    const c = new AbortController();
    active.current = c;
    setBusy(true);
    setMessage("");
    const popup = window.open(
      "about:blank",
      "_blank",
      "popup,width=600,height=720",
    );
    if (popup) popup.opener = null;
    try {
      const flow = (await requestJson(
        "https://identity.slop.cash/v1/oauth/start",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ audience: "slop-points-web" }),
          signal: c.signal,
        },
      )) as {
        authorizationUrl: string;
        flowId: string;
        pollCapability: string;
        expiresAt: string;
      };
      const url = new URL(flow.authorizationUrl);
      if (
        url.origin !== "https://identity.slop.cash" ||
        url.pathname !== "/v1/oauth/authorize" ||
        !/^flow_[A-Za-z0-9_-]{20,64}$/.test(flow.flowId) ||
        !/^[A-Za-z0-9_-]{40,128}$/.test(flow.pollCapability) ||
        !Number.isFinite(Date.parse(flow.expiresAt))
      )
        throw new Error("Invalid sign-in response");
      setAuthorization(url.href);
      if (popup) popup.location.replace(url.href);
      while (Date.now() < Date.parse(flow.expiresAt)) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            c.signal.removeEventListener("abort", abort);
            resolve();
          }, 2000);
          function abort() {
            clearTimeout(timer);
            reject(new Error("Sign-in cancelled"));
          }
          c.signal.addEventListener("abort", abort, { once: true });
        });
        const response = await fetch(
          "https://identity.slop.cash/v1/oauth/poll",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              audience: "slop-points-web",
              flowId: flow.flowId,
              pollCapability: flow.pollCapability,
            }),
            signal: c.signal,
          },
        );
        if (response.status === 202) continue;
        if (!response.ok)
          throw new Error("Sign-in expired. Please start again.");
        const result = (await readBoundedJson(response, 16384, "sign-in")) as {
          assertion: string;
        };
        const joined = await requestJson("/api/v1/points/join", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            assertion: result.assertion,
            public: publish,
          }),
          signal: c.signal,
        });
        setMe(member(joined));
        setMessage("You’re signed in. Your welcome points are recorded.");
        return;
      }
      throw new Error("Sign-in expired. Please start again.");
    } catch (e) {
      if (!c.signal.aborted)
        setMessage(e instanceof Error ? e.message : "Sign-in unavailable");
    } finally {
      if (active.current === c) {
        setBusy(false);
        setAuthorization(null);
      }
    }
  }
  async function signout() {
    try {
      await requestJson("/api/v1/points/signout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      setMe(null);
    } catch {
      setMessage("Could not sign out. Please retry.");
    }
  }
  if (!productOrigin())
    return (
      <section className="points-panel">
        <h2>Everyone starts somewhere</h2>
        <p>Join with GitHub for 5 welcome points. No wallet needed.</p>
        <a href="https://slop.cash/points">Join with GitHub on slop.cash</a>
      </section>
    );
  return (
    <section className="points-panel">
      <h2>{me ? `Welcome, ${me.actor.login}` : "Everyone starts somewhere"}</h2>
      {me ? (
        <>
          <p>
            5 welcome points ·{" "}
            <a href={`/contributors/${encodeURIComponent(me.actor.login)}`}>
              Your profile
            </a>
          </p>
          <button type="button" onClick={() => void signout()}>
            Sign out
          </button>
          <label>
            <input
              type="checkbox"
              checked={me.public}
              onChange={(e) => {
                void requestJson("/api/v1/points/visibility", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ public: e.target.checked }),
                }).then(
                  (v) => setMe(member(v)),
                  () => setMessage("Could not update visibility."),
                );
              }}
            />
            Show my membership publicly
          </label>
        </>
      ) : (
        <>
          <p>
            Join with GitHub for 5 welcome points. Your accepted contributions
            are recorded even before you join. No wallet needed.
          </p>
          <label>
            <input
              type="checkbox"
              checked={publish}
              disabled={busy}
              onChange={(e) => setPublish(e.target.checked)}
            />
            Show my membership publicly. Accepted contributions are already
            public.
          </label>
          <button type="button" disabled={busy} onClick={() => void start()}>
            {busy ? "Waiting for GitHub…" : "Join with GitHub"}
          </button>
          {busy ? (
            <button
              type="button"
              onClick={() => {
                active.current?.abort();
                setBusy(false);
                setAuthorization(null);
              }}
            >
              Cancel
            </button>
          ) : null}
          {authorization ? (
            <a href={authorization} target="_blank" rel="noreferrer">
              Open GitHub sign-in
            </a>
          ) : null}
        </>
      )}
      <p role="status">{message}</p>
    </section>
  );
}
export function PointsPage() {
  return (
    <main className="shell route-main points-page">
      <h1>Slop Points</h1>
      <p>Record your participation and accepted contributions.</p>
      <p>{POINTS_NOTICE}</p>
      <JoinPoints />
      <PointsStandings />
      <section className="points-panel">
        <h2>Ways to earn</h2>
        <p>
          Accepted code, documentation, tests, research, reviews, and approved
          useful support all count.
        </p>
        <p>
          Tiered contributions earn 10, 30, 90, 240, 450, or 750 points.
          Historical merges start at 10 points unless a verified score provides
          a different amount. Welcome points do not affect contribution
          standings.
        </p>
        <p>
          Points persist across months. Corrections are recorded in the history.
          Historic review coverage is limited to verified score and evaluation
          records.
        </p>
        <a href="/protocol/points-v1.md">Read the points rules</a> ·{" "}
        <a href="/#projects">Find a project</a> ·{" "}
        <a href="/data/points.json" download>
          Download points index
        </a>
      </section>
    </main>
  );
}
export function PointsStandings({
  projectId,
  compact = false,
}: {
  projectId?: string;
  compact?: boolean;
}) {
  const { state } = useContext(Context);
  const [period, setPeriod] = useState("month");
  const [query, setQuery] = useState("");
  const [project, setProject] = useState(projectId ?? "");
  const [page, setPage] = useState(0);
  const members = useMemo(() => {
    if (state.status !== "ready") return [];
    return pointMembers(
      state.journal,
      new Date().toISOString().slice(0, 7),
      project || undefined,
    );
  }, [state, project]);
  const metric = (m: PointsMember) =>
    period === "month" ? m.monthly : m.total;
  const ranked = [...members]
    .filter(
      (m) =>
        period !== "new" ||
        Date.parse(m.firstContributionAt) >= Date.now() - 30 * 86400000,
    )
    .sort(
      (a, b) => metric(b) - metric(a) || a.actor.id.localeCompare(b.actor.id),
    );
  const ranks = new Map<string, number>();
  let previous = -1;
  let rank = 0;
  ranked.forEach((m, i) => {
    if (metric(m) !== previous) rank = i + 1;
    previous = metric(m);
    ranks.set(m.actor.id, rank);
  });
  const rows = ranked.filter(
    (m) =>
      metric(m) > 0 &&
      m.actor.login.toLowerCase().includes(query.toLowerCase()),
  );
  const pageSize = compact ? 10 : 25;
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(rows.length / pageSize) - 1),
  );
  return (
    <section className="points-panel" aria-label="Points standings">
      <h2>{compact ? "Contribution points" : "Points standings"}</h2>
      <Notice />
      <div className="points-controls">
        <label>
          Period
          <select
            aria-label="Period"
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value);
              setPage(0);
            }}
          >
            <option value="month">This month (UTC)</option>
            <option value="lifetime">Recorded history</option>
            <option value="new">New contributors · 30 days</option>
          </select>
        </label>
        {!projectId ? (
          <label>
            Project
            <select
              aria-label="Project"
              value={project}
              onChange={(e) => {
                setProject(e.target.value);
                setPage(0);
              }}
            >
              <option value="">All projects</option>
              {PROJECTS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Find a contributor
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            type="search"
          />
        </label>
      </div>
      {state.status === "ready" ? (
        <>
          <div className="points-table">
            <table>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Contributor</th>
                  <th scope="col">Points</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice(currentPage * pageSize, (currentPage + 1) * pageSize)
                  .map((m) => (
                    <tr key={m.actor.id}>
                      <td>{ranks.get(m.actor.id)}</td>
                      <td>
                        <a
                          href={`/contributors/${encodeURIComponent(m.actor.login)}`}
                        >
                          {m.actor.login}
                        </a>
                      </td>
                      <td>{metric(m).toLocaleString()} pts</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {rows.length === 0 ? (
            <p>No recorded contributions match this view.</p>
          ) : null}
          <div className="points-controls">
            <button
              type="button"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
            >
              Previous
            </button>
            <span>
              Page {currentPage + 1} of{" "}
              {Math.max(1, Math.ceil(rows.length / pageSize))}
            </span>
            <button
              type="button"
              disabled={(currentPage + 1) * pageSize >= rows.length}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </button>
          </div>
        </>
      ) : null}
      <p className="points-meta">
        Contribution points only. Equal totals share a rank. Historical review
        coverage follows verified records.
      </p>
      {compact ? <a href="/points">Explore all points</a> : null}
    </section>
  );
}
