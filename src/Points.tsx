import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { readBoundedJson, readBoundedText } from "./lib/browser-json";
import type { CycleIndex } from "./lib/cycle-index";
import {
  assemblePoints,
  POINTS_NOTICE,
  type PointsIndex,
  type PointsJournal,
  type PointsMember,
  pointMembers,
} from "./lib/points";
import { findProject, PROJECTS } from "./lib/projects.mjs";
import { ContributorDirectory, ProfileActivity, useProfiles } from "./Profiles";

const productOrigin = () =>
  ["https://slop.cash", "https://slop.tech", "https://eliza.army"].includes(
    window.location.origin,
  );

interface Membership {
  actor: { id: string; login: string };
  joinedAt: string;
  public: boolean;
  welcome: number;
  socialPoints?: number;
}
type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; journal: PointsJournal; members: PointsMember[] };
const Context = createContext<{
  state: State;
  me: Membership | null;
  session: "loading" | "ready" | "error";
  refresh: () => void;
  requestPoints: () => void;
  setMe: (m: Membership | null) => void;
}>({
  state: { status: "loading" },
  me: null,
  session: "loading",
  refresh: () => {},
  requestPoints: () => {},
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
    (m.socialPoints !== undefined && ![0, 10].includes(m.socialPoints)) ||
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
  const [session, setSession] = useState<"loading" | "ready" | "error">(
    productOrigin() ? "loading" : "ready",
  );
  const [attempt, setAttempt] = useState(0);
  const [requested, setRequested] = useState(false);
  const shouldLoad = enabled || requested;
  // biome-ignore lint/correctness/useExhaustiveDependencies: retries and membership changes refresh public visibility.
  useEffect(() => {
    if (!shouldLoad) return;
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
    return () => controller.abort();
  }, [shouldLoad]);
  useEffect(() => {
    const controller = new AbortController();
    if (productOrigin())
      void fetch("/api/v1/points/me", {
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(15000),
        ]),
        cache: "no-store",
      })
        .then(async (r) => {
          if (r.status === 401) {
            setMe(null);
            setSession("ready");
            return;
          }
          if (!r.ok) throw new Error("session unavailable");
          const m = await readBoundedJson(r, 16384, "points session");
          if (m) setMe(member(m));
          setSession("ready");
        })
        .catch(() => {
          if (!controller.signal.aborted) setSession("error");
        });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!shouldLoad || !attempt) return;
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
  }, [attempt, shouldLoad]);
  return (
    <Context.Provider
      value={{
        state,
        me,
        session,
        setMe,
        refresh: () => setAttempt((a) => a + 1),
        requestPoints: () => setRequested(true),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function PointsNav({ onNavigate }: { onNavigate?: () => void }) {
  const { state, me, session, setMe, requestPoints, refresh } =
    useContext(Context);
  const [open, setOpen] = useState(false);
  const [failedImage, setFailedImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent | FocusEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeForEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const close = () => setOpen(false);
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", closeForEscape);
    window.addEventListener("focusin", outside);
    window.addEventListener("popstate", close);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", closeForEscape);
      window.removeEventListener("focusin", outside);
      window.removeEventListener("popstate", close);
    };
  }, [open]);
  const total =
    state.status === "ready" && me
      ? (state.members.find((m) => m.actor.id === me.actor.id)?.total ?? 0) +
        me.welcome +
        (me.socialPoints ?? 0)
      : null;
  const navigate = () => {
    setOpen(false);
    onNavigate?.();
  };
  async function signout() {
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/v1/points/signout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      setMe(null);
      setOpen(false);
    } catch {
      setError("Could not sign out. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  if (!me && session === "loading")
    return (
      <span className="account-control" role="status">
        Checking login…
      </span>
    );
  if (!me)
    return (
      <a
        className="account-control account-login"
        href="/login"
        onClick={navigate}
      >
        Log in
      </a>
    );
  const avatar = `https://avatars.githubusercontent.com/${encodeURIComponent(me.actor.login)}?size=80`;
  return (
    <div className="account-control" ref={root}>
      <button
        className="account-avatar"
        type="button"
        ref={trigger}
        aria-label="Your account"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (!open) {
            requestPoints();
            onNavigate?.();
          }
          setOpen(!open);
        }}
      >
        {failedImage === avatar ? (
          <span aria-hidden="true">
            {me.actor.login.slice(0, 2).toUpperCase()}
          </span>
        ) : (
          <img
            src={avatar}
            alt=""
            width={36}
            height={36}
            onError={() => setFailedImage(avatar)}
          />
        )}
      </button>
      {open ? (
        <section
          className="account-panel"
          id={panelId}
          aria-label="Your account details"
        >
          <strong>@{me.actor.login}</strong>
          {total !== null ? (
            <p>{total.toLocaleString()} pts</p>
          ) : (
            <p role="status">
              {state.status === "error"
                ? "Points unavailable"
                : "Loading points…"}
            </p>
          )}
          {state.status === "error" ? (
            <button type="button" onClick={refresh}>
              Retry points
            </button>
          ) : null}
          <a
            href={`/contributors/${encodeURIComponent(me.actor.login)}`}
            onClick={navigate}
          >
            View profile
          </a>
          <a href="/points" onClick={navigate}>
            Account settings
          </a>
          <button type="button" onClick={() => void signout()} disabled={busy}>
            {busy ? "Signing out…" : "Sign out"}
          </button>
          {error ? <p role="alert">{error}</p> : null}
        </section>
      ) : null}
    </div>
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
export function ProfilePoints({
  login,
  cycles,
  showIdentity = false,
}: {
  login: string;
  cycles?: CycleIndex;
  showIdentity?: boolean;
}) {
  const { state, me } = useContext(Context);
  const census = useProfiles();
  const censusMatches =
    census.state.status === "ready"
      ? census.state.index.people.filter(
          (p) => p.login.toLowerCase() === login.toLowerCase(),
        )
      : [];
  const recorded = censusMatches.length === 1 ? censusMatches[0] : undefined;
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
  const resolvedActorId = identity?.actor.id ?? recorded?.id;
  const m =
    state.status === "ready"
      ? resolvedActorId
        ? state.members.find((m) => m.actor.id === resolvedActorId)
        : named.length === 1
          ? named[0]
          : undefined
      : undefined;
  const [copied, setCopied] = useState("");
  return (
    <section className="points-panel" aria-label="Slop Points">
      <ProfileActivity
        login={login}
        actorId={(m?.actor ?? identity?.actor ?? recorded)?.id}
        census={census}
        cycles={cycles}
        showIdentity={showIdentity}
      />
      <h2>Slop Points</h2>
      <Notice />
      {state.status === "ready" && (m || identity || recorded) ? (
        <>
          <p className="points-total">
            {(
              (m?.total ?? 0) +
              (identity?.welcome ?? 0) +
              (identity?.socialPoints ?? 0)
            ).toLocaleString()}{" "}
            <span>pts</span>
          </p>
          <p>
            {m?.monthly.toLocaleString() ?? "0"} earned points this month
            {identity
              ? ` · 5 welcome points · ${identity.socialPoints ?? 0} X connection points`
              : ""}
          </p>
          {m || identity || recorded ? (
            <PublicXLink
              actorId={(m?.actor ?? identity?.actor ?? recorded!).id}
            />
          ) : null}
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
      {own ? (
        <p>
          <a href="/points">Manage account and social connections</a>
        </p>
      ) : null}
      <a href="/points">How to earn points</a>
    </section>
  );
}
function JoinPoints({
  redirectToProfile = false,
}: {
  redirectToProfile?: boolean;
}) {
  const { me, setMe, session } = useContext(Context);
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
        const signedIn = member(joined);
        setMe(signedIn);
        if (redirectToProfile)
          window.location.assign(
            `/contributors/${encodeURIComponent(signedIn.actor.login)}`,
          );
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
        <h2>Sign in to Slop</h2>
        <p>
          Sign in with your GitHub account. New members receive 5 welcome
          points.
        </p>
        <a href="https://slop.cash/login">Continue with GitHub on slop.cash</a>
      </section>
    );
  return (
    <section className="points-panel">
      <h2>{me ? `Welcome, ${me.actor.login}` : "Sign in to Slop"}</h2>
      {!me && session === "error" ? (
        <p role="status">
          We couldn’t check your session. Sign in with GitHub to try again.
        </p>
      ) : null}
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
            GitHub is the only way to sign in. New members receive 5 welcome
            points. Your accepted contributions are recorded even before you
            join. No wallet needed.
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
          <button
            type="button"
            disabled={busy || session === "loading"}
            onClick={() => void start()}
          >
            {busy ? "Waiting for GitHub…" : "Continue with GitHub"}
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
export function LoginPage() {
  return (
    <main className="shell route-main points-page">
      <h1>Log in</h1>
      <p>
        Use your GitHub account to access your profile and manage your
        connections.
      </p>
      <JoinPoints redirectToProfile />
    </main>
  );
}
export function PointsPage() {
  return (
    <main className="shell route-main points-page">
      <h1>Slop Points</h1>
      <p>Record your participation and accepted contributions.</p>
      <p>{POINTS_NOTICE}</p>
      <JoinPoints />
      <SocialConnections />
      <CommunityPeople />
      <ContributorDirectory />
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
          a different amount. Each finalized project payout cycle earns its
          recipient 25 points, regardless of amount or transaction count.
          Welcome and X connection points appear on profiles and in the
          community directory; they do not affect earned-point standings.
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
  title,
}: {
  projectId?: string;
  compact?: boolean;
  title?: string;
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
    <section className="points-panel" aria-label={title ?? "Points standings"}>
      <h2>{title ?? (compact ? "Contribution points" : "Points standings")}</h2>
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
            <option value="new">New earners · 30 days</option>
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
        Contribution and verified payout points. Equal totals share a rank.
        Historical review coverage follows verified records.
      </p>
      {compact ? <a href="/points">Your profile and ways to earn</a> : null}
    </section>
  );
}

type XAccount = { id: string; username: string; verifiedAt: string };
function xAccount(value: unknown): XAccount {
  const x = value as XAccount;
  if (
    !x ||
    !/^[0-9]{1,30}$/.test(x.id) ||
    !/^[A-Za-z0-9_]{1,15}$/.test(x.username) ||
    !Number.isFinite(Date.parse(x.verifiedAt))
  )
    throw new Error("Invalid X identity");
  return x;
}
function XAccountLink({ account }: { account: XAccount }) {
  return (
    <a
      href={`https://x.com/intent/user?user_id=${encodeURIComponent(account.id)}`}
      target="_blank"
      rel="noreferrer"
      title={`Account connected ${account.verifiedAt.slice(0, 10)}`}
    >
      X · @{account.username}
    </a>
  );
}
export function PublicXLink({ actorId }: { actorId: string }) {
  const [account, setAccount] = useState<XAccount | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setAccount(null);
    setFailed(false);
    if (!productOrigin()) return;
    const c = new AbortController();
    void requestJson(
      `/api/v1/points/x/profile?actor=${encodeURIComponent(actorId)}`,
      { signal: c.signal },
    )
      .then((v) => setAccount(v ? xAccount(v) : null))
      .catch(() => {
        if (!c.signal.aborted) setFailed(true);
      });
    return () => c.abort();
  }, [actorId]);
  return account ? (
    <span className="points-social-link">
      <XAccountLink account={account} />
    </span>
  ) : failed ? (
    <small>X link unavailable</small>
  ) : null;
}
function SocialConnections() {
  const { me, setMe } = useContext(Context);
  const [data, setData] = useState<{
    configured: boolean;
    account: (XAccount & { public: number }) | null;
    award: { points: number; awardedAt: string } | null;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [publish, setPublish] = useState(false);
  const [version, setVersion] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: version explicitly refreshes the server state after account mutations.
  useEffect(() => {
    setData(null);
    setPublish(false);
    if (!me || !productOrigin()) return;
    const c = new AbortController();
    void requestJson("/api/v1/points/x/me", { signal: c.signal })
      .then((value) => {
        const v = value as NonNullable<typeof data>;
        if (
          typeof v.configured !== "boolean" ||
          (v.account && ![0, 1].includes(v.account.public)) ||
          (v.award &&
            (v.award.points !== 10 ||
              !Number.isFinite(Date.parse(v.award.awardedAt))))
        )
          throw new Error("Invalid connection state");
        if (v.account) xAccount(v.account);
        setData(v);
      })
      .catch(() => {
        if (!c.signal.aborted)
          setMessage("X connection details are unavailable. Retry below.");
      });
    return () => c.abort();
  }, [me, version]);
  const outcome = new URLSearchParams(window.location.search).get("x");
  async function action(path: string, body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const value = await requestJson(`/api/v1/points/x/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (path === "start") {
        const url = new URL(
          (value as { authorizationUrl: string }).authorizationUrl,
        );
        if (
          url.origin !== "https://x.com" ||
          url.pathname !== "/i/oauth2/authorize"
        )
          throw new Error("Invalid authorization");
        window.location.assign(url.href);
        return;
      }
      setVersion((v) => v + 1);
      if (me) setMe({ ...me });
      setMessage(
        path === "disconnect"
          ? "X disconnected. Your earned points are retained."
          : "X visibility updated.",
      );
    } catch {
      setMessage("Could not complete the X connection request. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="points-panel" aria-label="Connect X">
      <h2>Connect your X account</h2>
      <p>
        Sloperators, maintainers, reviewers, and supporters can all connect.
        Earn 10 points once and help people find you.
      </p>
      {outcome === "connected" ? (
        <p role="status">X connected. Your connection points are recorded.</p>
      ) : outcome === "cancelled" ? (
        <p role="status">X connection cancelled. No new points were awarded.</p>
      ) : outcome === "failed" ? (
        <p role="status">
          X could not be connected. Try again; an X account already claimed by
          another Slop member cannot be reused.
        </p>
      ) : null}
      {!me ? (
        <p>Join with GitHub above, then connect X.</p>
      ) : !data ? (
        <>
          <p role="status">{message || "Loading connection details…"}</p>
          <button type="button" onClick={() => setVersion((v) => v + 1)}>
            Retry X details
          </button>
        </>
      ) : (
        <>
          {data.award ? (
            <p>
              10 connection points · earned {data.award.awardedAt.slice(0, 10)}
            </p>
          ) : null}
          {data.account ? (
            <>
              <p>
                <XAccountLink account={data.account} />
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={data.account.public === 1}
                  disabled={busy}
                  onChange={(e) =>
                    void action("visibility", { public: e.target.checked })
                  }
                />
                Show my X account with my public membership
              </label>
              {!me.public ? (
                <p>
                  Your membership is private. Publish it above to display your X
                  link.
                </p>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => void action("disconnect", {})}
              >
                Disconnect X
              </button>
            </>
          ) : null}
          {data.configured ? (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={publish}
                  disabled={busy}
                  onChange={(e) => setPublish(e.target.checked)}
                />
                Show this X connection with my public membership
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => void action("start", { public: publish })}
              >
                {busy
                  ? "Connecting…"
                  : data.account
                    ? "Reconnect or change X account"
                    : "Connect X · +10 points once"}
              </button>
            </>
          ) : (
            <p>X connections are not enabled yet.</p>
          )}
          <p>
            Connecting verifies your account. Slop does not request posting or
            messaging permissions. Reconnecting, changing handles, or
            disconnecting does not create another award.
          </p>
          <p role="status">{message}</p>
        </>
      )}
    </section>
  );
}
type Person = {
  actor: { id: string; login: string };
  welcome: number;
  socialPoints: number;
  x: XAccount | null;
};
function CommunityPeople() {
  const { state, me } = useContext(Context);
  const [people, setPeople] = useState<Person[]>([]);
  const [cursor, setCursor] = useState("");
  const [prior, setPrior] = useState<string[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [status, setStatus] = useState("loading");
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retries and membership changes refresh public visibility.
  useEffect(() => {
    if (!productOrigin()) {
      setStatus("preview");
      return;
    }
    const c = new AbortController();
    setStatus("loading");
    void requestJson(
      `/api/v1/points/people?after=${encodeURIComponent(cursor)}`,
      { signal: c.signal },
    )
      .then((value) => {
        const v = value as { people: Person[]; next: string | null };
        if (
          !Array.isArray(v.people) ||
          v.people.length > 25 ||
          (v.next !== null && !/^[A-Za-z0-9_=-]{4,256}$/.test(v.next))
        )
          throw new Error("Invalid community page");
        for (const p of v.people) {
          if (
            !/^[A-Za-z0-9_=-]{4,256}$/.test(p.actor?.id) ||
            !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(p.actor.login) ||
            p.welcome !== 5 ||
            ![0, 10].includes(p.socialPoints)
          )
            throw new Error("Invalid community member");
          if (p.x) xAccount(p.x);
        }
        setPeople(v.people);
        setNext(v.next);
        setStatus("ready");
      })
      .catch(() => {
        if (!c.signal.aborted) setStatus("error");
      });
    return () => c.abort();
  }, [cursor, attempt, me]);
  return (
    <section
      className="points-panel"
      id="people"
      aria-label="Community members"
    >
      <h2>Meet the community</h2>
      <p>
        Everyone who chooses a public membership can appear here, including
        people still getting started.
      </p>
      {status === "preview" ? (
        <a href="https://slop.cash/points#people">
          View public members on slop.cash
        </a>
      ) : status === "loading" ? (
        <p role="status">Loading members…</p>
      ) : status === "error" ? (
        <>
          <p role="status">Community members are unavailable.</p>
          <button type="button" onClick={() => setAttempt((v) => v + 1)}>
            Retry members
          </button>
        </>
      ) : (
        <>
          <ul className="points-people">
            {people.map((p) => {
              const earned =
                state.status === "ready"
                  ? (state.members.find((m) => m.actor.id === p.actor.id)
                      ?.total ?? 0)
                  : null;
              const steward = PROJECTS.filter(
                (project) =>
                  project.authority.state === "verified" &&
                  project.steward.github.nodeId === p.actor.id,
              );
              return (
                <li key={p.actor.id}>
                  <a
                    href={`/contributors/${encodeURIComponent(p.actor.login)}`}
                  >
                    {p.actor.login}
                  </a>
                  <span>
                    {earned === null
                      ? `${p.welcome + p.socialPoints} participation pts · earned points unavailable`
                      : `${(earned + p.welcome + p.socialPoints).toLocaleString()} pts`}
                  </span>
                  {steward.length ? (
                    <small>
                      Project steward · {steward.map((p) => p.name).join(", ")}
                    </small>
                  ) : null}
                  {p.x ? <XAccountLink account={p.x} /> : null}
                </li>
              );
            })}
          </ul>
          {!people.length ? <p>No public members on this page yet.</p> : null}
          <div className="points-controls">
            <button
              type="button"
              disabled={!prior.length}
              onClick={() => {
                setCursor(prior.at(-1) ?? "");
                setPrior((p) => p.slice(0, -1));
              }}
            >
              Previous members
            </button>
            <button
              type="button"
              disabled={!next}
              onClick={() => {
                setPrior((p) => [...p, cursor]);
                setCursor(next ?? "");
              }}
            >
              Next members
            </button>
          </div>
        </>
      )}
    </section>
  );
}
