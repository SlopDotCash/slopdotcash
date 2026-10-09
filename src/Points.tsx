import { ChevronDown } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { identityPublicOrigin } from "../workers/identity/contracts";
import { browserDeployment } from "./lib/browser-deployment";
import {
  fetchWithDeadline,
  readBoundedJson,
  readBoundedText,
} from "./lib/browser-json";
import {
  contributorStandings,
  type StandingsSort,
} from "./lib/contributor-standings";
import type { CycleIndex } from "./lib/cycle-index";
import { deploymentTier } from "./lib/deployment";
import { requestIdentityAssertion } from "./lib/identity-flow";
import type { ScoreEvent } from "./lib/leaderboard";
import {
  assemblePoints,
  POINTS_NOTICE,
  type PointsIndex,
  type PointsJournal,
  type PointsMember,
  pointMembers,
} from "./lib/points";
import { profileCounts } from "./lib/profiles";
import { findProject, PROJECTS } from "./lib/projects.mjs";
import { type DataState, useSnapshot } from "./lib/use-snapshot";
import { DataNotice, formatMicroUsdc, formatScore } from "./Presentation";
import { ProfileActivity, useProfiles } from "./Profiles";
import { WalletRegistration } from "./WalletRegistration";

const productOrigin = () =>
  browserDeployment.browserOrigins.has(window.location.origin);

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
  const response = await fetchWithDeadline(url, {
    ...init,
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
      const r = await fetchWithDeadline(s.path, { signal, cache: "no-store" });
      if (!r.ok) throw new Error("Points shard unavailable");
      return readBoundedText(r, 8 * 1024 * 1024, "points history");
    }),
  );
  return assemblePoints(index, parts);
}
/** Same-origin path from `next`; anything else falls back to the profile. */
export function returnPath(search = window.location.search): string | null {
  const next = new URLSearchParams(search).get("next");
  if (!next) return null;
  if (next === "earnings") return "/earnings";
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\"))
    return null;
  try {
    const url = new URL(next, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname === "/login")
      return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt triggers an explicit reload.
  useEffect(() => {
    if (!shouldLoad) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    void loadPoints(controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
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
  }, [shouldLoad, attempt]);
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
const currentPath = () =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;

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
  const signedIn = me !== null;
  useEffect(() => {
    if (signedIn) requestPoints();
  }, [signedIn, requestPoints]);
  const [loginReturn, setLoginReturn] = useState(currentPath);
  useEffect(() => {
    const update = () => setLoginReturn(currentPath());
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
    };
  }, []);
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
        href={
          window.location.pathname === "/login" || loginReturn === "/"
            ? "/login"
            : `/login?next=${encodeURIComponent(loginReturn)}`
        }
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
        {total !== null ? (
          <span className="account-points">{total.toLocaleString()} pts</span>
        ) : null}
        <ChevronDown aria-hidden="true" className="account-chevron" />
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
          <a href="/earnings" onClick={navigate}>
            Earnings and wallets
          </a>
          <a href="/account" onClick={navigate}>
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
export function ProfilePoints({
  work,
  actorId,
  summary,
  login,
  cycles,
  recordsLoading = false,
  showIdentity = false,
}: {
  login: string;
  work?: readonly ScoreEvent[];
  cycles?: CycleIndex;
  recordsLoading?: boolean;
  showIdentity?: boolean;
  summary?: ReactNode;
  actorId?: string;
}) {
  const { state, me } = useContext(Context);
  const census = useProfiles();
  const censusMatches =
    census.state.status === "ready"
      ? census.state.index.people.filter((p) =>
          actorId
            ? p.id === actorId
            : p.login.toLowerCase() === login.toLowerCase(),
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
  const membership = own ?? joined;
  const identity =
    !actorId || membership?.actor.id === actorId ? membership : null;
  const resolvedActorId = actorId ?? identity?.actor.id ?? recorded?.id;
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
        work={work}
        awards={m?.awards}
        login={login}
        actorId={resolvedActorId ?? m?.actor.id}
        census={census}
        cycles={cycles}
        recordsLoading={recordsLoading}
        showIdentity={showIdentity}
        summary={
          <>
            {summary}
            <div>
              <strong>
                {state.status === "ready" && (m || identity || recorded)
                  ? (
                      (m?.total ?? 0) +
                      (identity?.welcome ?? 0) +
                      (identity?.socialPoints ?? 0)
                    ).toLocaleString()
                  : state.status === "loading"
                    ? "Loading…"
                    : "Unavailable"}
              </strong>
              <span>Points · recorded history</span>
            </div>
          </>
        }
      />
      <h2>Slop Points</h2>
      <Notice />
      {state.status === "ready" && (m || identity || recorded) ? (
        <>
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
          <a href="/account">Manage account and social connections</a>
        </p>
      ) : null}
      <a href="/points#rules">How to earn points</a>
    </section>
  );
}
function JoinPoints({
  redirectToProfile = false,
  showHeading = true,
}: {
  redirectToProfile?: boolean;
  showHeading?: boolean;
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
      const assertion = await requestIdentityAssertion({
        origin: identityPublicOrigin(
          [
            "https://staging.slop.cash",
            "https://slop-staging.pages.dev",
          ].includes(window.location.origin)
            ? import.meta.env.VITE_IDENTITY_PUBLIC_ORIGIN
            : undefined,
          deploymentTier(import.meta.env.VITE_SLOP_ENVIRONMENT),
        ),
        audience: "slop-points-web",
        signal: c.signal,
        authorize: (url) => {
          setAuthorization(url);
          if (popup) popup.location.replace(url);
        },
        request: async (url, init) => {
          const response = await fetchWithDeadline(url, {
            ...init,
            signal: c.signal,
            credentials: "omit",
            redirect: "error",
            cache: "no-store",
            referrerPolicy: "no-referrer",
          });
          if (!response.ok)
            throw new Error("Sign-in expired. Please start again.");
          const body = await readBoundedJson(response, 16384, "sign-in");
          if (!body || typeof body !== "object" || Array.isArray(body))
            throw new Error("Invalid sign-in response");
          return {
            status: response.status,
            body: body as Record<string, unknown>,
          };
        },
      });
      const joined = await requestJson("/api/v1/points/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assertion,
          public: publish,
        }),
        signal: c.signal,
      });
      const signedIn = member(joined);
      setMe(signedIn);
      if (redirectToProfile)
        window.location.assign(
          returnPath() ??
            `/contributors/${encodeURIComponent(signedIn.actor.login)}`,
        );
      setMessage("You’re signed in. Your welcome points are recorded.");
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
        {showHeading ? <h2>Sign in to Slop</h2> : null}
        <p>Use GitHub to manage your profile.</p>
        <a href={`${browserDeployment.site}/login`}>
          Continue with GitHub on {new URL(browserDeployment.site).hostname}
        </a>
      </section>
    );
  return (
    <section className="points-panel">
      {showHeading ? (
        <h2>{me ? `@${me.actor.login}` : "Sign in to Slop"}</h2>
      ) : null}
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
                  (v) => {
                    setMe(member(v));
                    setMessage(
                      "Membership visibility saved. Public contribution records are unchanged.",
                    );
                  },
                  () => setMessage("Could not update visibility."),
                );
              }}
            />
            Show my membership publicly
          </label>
        </>
      ) : (
        <>
          <p>Use GitHub to manage your profile.</p>
          <button
            className="button primary-button"
            type="button"
            disabled={busy || session === "loading"}
            onClick={() => void start()}
          >
            {busy ? "Waiting for GitHub…" : "Continue with GitHub"}
          </button>
          <label>
            <input
              type="checkbox"
              checked={publish}
              disabled={busy}
              onChange={(e) => setPublish(e.target.checked)}
            />
            Optional: show my membership publicly. Accepted contributions are
            already public.
          </label>
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
      <JoinPoints redirectToProfile showHeading={false} />
    </main>
  );
}
export function AccountPage() {
  const { me } = useContext(Context);
  return (
    <main className="shell route-main points-page">
      <h1>Account</h1>
      <nav className="account-sections" aria-label="Account sections">
        <a href="#profile">Profile</a>
        {me ? <a href="#connections">Connections</a> : null}
        <a href="#wallets">Wallets</a>
        <a href="/earnings">Earnings</a>
      </nav>
      <div id="profile">
        <JoinPoints />
      </div>
      <div id="connections">
        <SocialConnections />
      </div>
      <WalletRegistration />
      <p>
        <a href="/points#rules">Points and earning rules</a>
      </p>
    </main>
  );
}
/** Categories from protocol/points-v1.md: activity, points, earned standings. */
const POINT_CATEGORIES: readonly (readonly [string, string, boolean])[] = [
  [
    "Accepted work: micro, small, medium, large, XL, exceptional",
    "10 · 30 · 90 · 240 · 450 · 750",
    true,
  ],
  ["Reviews: triage, standard, deep, specialist", "10 · 30 · 90 · 240", true],
  ["Historical merged PR before scoring records", "10 each", true],
  ["Finalized payout cycle", "25 per project and month", true],
  ["Join with GitHub", "5 once", false],
  ["First X connection", "10 once", false],
];
export function PointsPage() {
  return (
    <main className="shell route-main points-page">
      <h1>Slop Points</h1>
      <p>{POINTS_NOTICE}</p>
      <p>
        <a href="/account">Account settings</a> ·{" "}
        <a href="#people">Find people</a> · <a href="#rules">Ways to earn</a>
      </p>
      <ContributorStandings />
      <section className="points-panel" id="rules">
        <h2>Ways to earn</h2>
        <ul aria-label="Point categories" className="points-rules">
          {POINT_CATEGORIES.map(([activity, points, ranked]) => (
            <li key={activity}>
              <span>{activity}</span>
              <strong>{points}</strong>
              <small>
                {ranked
                  ? "Counts in earned-point standings"
                  : "Not in earned-point standings"}
              </small>
            </li>
          ))}
        </ul>
        <p className="points-meta">
          Points never change Slop Score or Money received. Points persist
          across months, and corrections stay in the history. Review coverage
          before scoring records is limited.
        </p>
        <a href="/protocol/points-v1.md">Read the points rules</a> ·{" "}
        <a href="/#projects">Find a project</a> ·{" "}
        <a href="/data/points.json" download>
          Download points index
        </a>
      </section>
      <People />
    </main>
  );
}
export function ContributorStandings({
  scoreState,
  retryScore,
  projectId,
  compact = false,
  title,
}: {
  projectId?: string;
  compact?: boolean;
  title?: string;
  scoreState?: DataState;
  retryScore?: () => void;
}) {
  const [loadedScore, retryLoadedScore] = useSnapshot(!scoreState);
  const scores = scoreState ?? loadedScore;
  const readFilters = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const sort = params.get("sort");
    const period = params.get("period");
    // `period=new` was the earlier combined control: the new-earner cohort
    // over recorded history.
    return {
      sort:
        sort === "points" || sort === "money"
          ? sort
          : ("score" as StandingsSort),
      period: period === "lifetime" || period === "new" ? "lifetime" : "month",
      cohort:
        params.get("cohort") === "new" || period === "new" ? "new" : "all",
      query: params.get("q") ?? "",
      project: projectId ?? findProject(params.get("project") ?? "")?.id ?? "",
      page: Math.max(
        0,
        Number.parseInt(params.get("page") ?? "1", 10) - 1 || 0,
      ),
    };
  }, [projectId]);
  const [filters, setFilters] = useState(readFilters);
  const { sort, period, cohort, query, project, page } = filters;
  const setSort = (sort: StandingsSort) =>
    setFilters((v) => ({ ...v, sort, page: 0 }));
  const setPeriod = (period: string) =>
    setFilters((v) => ({ ...v, period, page: 0 }));
  const setCohort = (cohort: string) =>
    setFilters((v) => ({ ...v, cohort, page: 0 }));
  const setQuery = (query: string) =>
    setFilters((v) => ({ ...v, query, page: 0 }));
  const setProject = (project: string) =>
    setFilters((v) => ({ ...v, project, page: 0 }));
  const setPage = (page: number) => setFilters((v) => ({ ...v, page }));
  useEffect(() => {
    const restore = () => setFilters(readFilters());
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [readFilters]);
  useEffect(() => {
    const url = new URL(window.location.href);
    for (const [key, value] of Object.entries({
      sort: sort === "score" ? "" : sort,
      period: period === "month" ? "" : period,
      cohort: cohort === "all" ? "" : cohort,
      q: query,
      project: projectId ? "" : project,
      page: page ? String(page + 1) : "",
    })) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState(window.history.state, "", url);
  }, [sort, period, cohort, query, project, page, projectId]);
  const { state } = useContext(Context);
  const members = useMemo(() => {
    if (state.status !== "ready") return [];
    return pointMembers(
      state.journal,
      new Date().toISOString().slice(0, 7),
      project || undefined,
    );
  }, [state, project]);
  const metric = (
    m: ReturnType<typeof contributorStandings>["rows"][number],
  ) => (sort === "score" ? m.score : sort === "points" ? m.points : m.money);
  const projection = contributorStandings(
    scores,
    state.status === "ready" ? members : null,
    period === "month" ? new Date().toISOString().slice(0, 7) : null,
    project,
  );
  // Loading and failed sources stay distinct in each column.
  const scoreMissing = scores.status === "loading" ? "Loading…" : "Unavailable";
  const pointsMissing = state.status === "loading" ? "Loading…" : "Unavailable";
  const ranked = projection.rows
    .filter(
      (m) =>
        cohort !== "new" ||
        (m.firstContributionAt !== null &&
          Date.parse(m.firstContributionAt) >= Date.now() - 30 * 86400000),
    )
    .filter((m) => metric(m) !== null)
    .sort((a, b) => {
      const left = metric(a) ?? 0;
      const right = metric(b) ?? 0;
      return (
        (left < right ? 1 : left > right ? -1 : 0) ||
        a.actor.id.localeCompare(b.actor.id)
      );
    });
  const ranks = new Map<string, number>();
  let previous: number | bigint | null = null;
  let rank = 0;
  ranked.forEach((m, i) => {
    if (metric(m) !== previous) rank = i + 1;
    previous = metric(m);
    ranks.set(m.actor.id, rank);
  });
  const rows = ranked.filter(
    (m) =>
      ((m.score ?? 0) !== 0 || (m.points ?? 0) > 0 || (m.money ?? 0n) > 0n) &&
      m.actor.login.toLowerCase().includes(query.toLowerCase()),
  );
  const pageSize = compact ? 10 : 25;
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(rows.length / pageSize) - 1),
  );
  return (
    <section
      className="points-panel"
      aria-label={title ?? "Contributor standings"}
    >
      <h2>{title ?? "Contributor standings"}</h2>
      {!scoreState ? (
        <DataNotice state={scores} retry={retryScore ?? retryLoadedScore} />
      ) : null}
      <Notice />
      {scores.status === "ready" ? (
        <p className="points-meta">
          Score records: {scores.snapshot.window.from} to{" "}
          {scores.snapshot.window.to}, plus closed cycles.
          {period === "month"
            ? ` Selected month: ${new Date().toISOString().slice(0, 7)} (UTC).`
            : " Recorded history; coverage may have gaps."}
          {!projection.scoreAvailable
            ? " No score records cover this period. Select Recorded history or retry after the next update."
            : ""}
        </p>
      ) : null}
      <div className="points-controls">
        <label>
          Sort by
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as StandingsSort);
              setPage(0);
            }}
          >
            <option value="score">Slop Score</option>
            <option value="points">Points</option>
            <option value="money">Money received</option>
          </select>
        </label>
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
          </select>
        </label>
        <label>
          Cohort
          <select
            aria-label="Cohort"
            value={cohort}
            onChange={(e) => setCohort(e.target.value)}
          >
            <option value="all">All contributors</option>
            <option value="new">New · first contribution in 30 days</option>
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
      {(
        sort === "points"
          ? state.status === "ready"
          : scores.status === "ready" &&
            (sort !== "score" || projection.scoreAvailable)
      ) ? (
        <>
          <p className="standings-scroll-hint">
            Scroll the table to see all columns.
          </p>
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
                  <th scope="col">Slop Score</th>
                  <th scope="col">Points</th>
                  <th scope="col">Money received · USDC</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice(currentPage * pageSize, (currentPage + 1) * pageSize)
                  .map((m) => (
                    <tr key={m.actor.id}>
                      <td className="points-rank">{ranks.get(m.actor.id)}</td>
                      <td>
                        <a
                          className="points-person"
                          href={`/contributors/${encodeURIComponent(m.actor.login)}`}
                        >
                          <img
                            alt=""
                            height={40}
                            loading="lazy"
                            onError={(event) => {
                              event.currentTarget.hidden = true;
                            }}
                            src={`https://avatars.githubusercontent.com/${encodeURIComponent(m.actor.login)}?size=80`}
                            width={40}
                          />
                          {m.actor.login}
                        </a>
                      </td>
                      <td className="points-value">
                        {m.score === null ? scoreMissing : formatScore(m.score)}
                      </td>
                      <td className="points-value">
                        {m.points === null
                          ? pointsMissing
                          : `${m.points.toLocaleString()} pts`}
                      </td>
                      <td className="points-value">
                        {m.money === null
                          ? scoreMissing
                          : formatMicroUsdc(m.money.toString())}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
          {rows.length === 0 ? (
            <p>No recorded contributions match this view.</p>
          ) : null}
          <div className="points-controls points-pagination">
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
        Slop Score measures accepted work. Points record recognition. Money
        received is verified finalized USDC principal. Equal values share a
        rank. Historical review coverage follows verified records.
      </p>
      {compact ? (
        <p>
          <a href="/points">Full standings and earning rules</a> ·{" "}
          <a href="/points#people">Find people</a>
        </p>
      ) : null}
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
  if (!me) return null;
  return (
    <section className="points-panel" aria-label="Connect X">
      <h2>Connections</h2>
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
      {!data ? (
        <>
          <p role="status">{message || "Loading connection details…"}</p>
          <button type="button" onClick={() => setVersion((v) => v + 1)}>
            Retry X details
          </button>
        </>
      ) : (
        <>
          <div className="connection-row">
            <strong>X</strong>
            <span>
              {data.account ? (
                <>
                  Connected · <XAccountLink account={data.account} />
                </>
              ) : (
                "Not connected"
              )}
            </span>
            <span>
              {data.award
                ? `+10 points · earned ${data.award.awardedAt.slice(0, 10)}`
                : "+10 points once"}
            </span>
            {data.account ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void action("disconnect", {})}
              >
                Disconnect X
              </button>
            ) : data.configured ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void action("start", { public: publish })}
              >
                {busy ? "Connecting…" : "Connect X"}
              </button>
            ) : (
              <span>Not enabled yet</span>
            )}
          </div>
          {data.account || data.configured ? (
            <label>
              <input
                type="checkbox"
                checked={data.account ? data.account.public === 1 : publish}
                disabled={busy}
                onChange={(e) =>
                  data.account
                    ? void action("visibility", { public: e.target.checked })
                    : setPublish(e.target.checked)
                }
              />
              Show my X account with my public membership
            </label>
          ) : null}
          {data.account && !me.public ? (
            <p>Your membership is private, so your X link stays hidden.</p>
          ) : null}
          <p className="points-meta">
            Slop does not request posting or messaging permissions. A new handle
            or connection does not create another award.
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
type MemberState =
  | { status: "loading" | "error" | "preview" }
  | { status: "ready"; people: Person[] };
function validPerson(p: Person) {
  if (
    !/^[A-Za-z0-9_=-]{4,256}$/.test(p.actor?.id) ||
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(p.actor.login) ||
    p.welcome !== 5 ||
    ![0, 10].includes(p.socialPoints)
  )
    throw new Error("Invalid community member");
  if (p.x) xAccount(p.x);
}
/** Reads every public-member page; cursors must strictly advance. */
async function loadMembers(signal: AbortSignal): Promise<Person[]> {
  const people: Person[] = [];
  let cursor = "";
  for (;;) {
    const v = (await requestJson(
      `/api/v1/points/people?after=${encodeURIComponent(cursor)}`,
      { signal },
    )) as { people: Person[]; next: string | null };
    if (
      !Array.isArray(v.people) ||
      v.people.length > 25 ||
      (v.next !== null &&
        (!/^[A-Za-z0-9_=-]{4,256}$/.test(v.next) || v.next <= cursor))
    )
      throw new Error("Invalid community page");
    for (const p of v.people) validPerson(p);
    people.push(...v.people);
    if (v.next === null) return people;
    cursor = v.next;
  }
}
const PEOPLE_PAGE_SIZE = 24;
/**
 * One people view: public members and everyone with a recorded pull request.
 * People without score stay discoverable without receiving a rank.
 */
function People() {
  const { state, me } = useContext(Context);
  const census = useProfiles();
  const [members, setMembers] = useState<MemberState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retries and membership changes refresh public visibility.
  useEffect(() => {
    if (!productOrigin()) {
      setMembers({ status: "preview" });
      return;
    }
    const c = new AbortController();
    setMembers({ status: "loading" });
    void loadMembers(c.signal)
      .then((people) => setMembers({ status: "ready", people }))
      .catch(() => {
        if (!c.signal.aborted) setMembers({ status: "error" });
      });
    return () => c.abort();
  }, [attempt, me]);
  const people = useMemo(() => {
    const byId = new Map<
      string,
      { id: string; login: string; merged: number | null; member?: Person }
    >();
    if (census.state.status === "ready")
      for (const p of census.state.index.people)
        byId.set(p.id, {
          id: p.id,
          login: p.login,
          merged: profileCounts(p).merged,
        });
    if (members.status === "ready")
      for (const p of members.people) {
        const known = byId.get(p.actor.id);
        byId.set(p.actor.id, {
          id: p.actor.id,
          login: known?.login ?? p.actor.login,
          merged: known?.merged ?? (census.state.status === "ready" ? 0 : null),
          member: p,
        });
      }
    return [...byId.values()].sort((a, b) => a.login.localeCompare(b.login));
  }, [census.state, members]);
  const matches = people.filter((p) =>
    p.login.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(matches.length / PEOPLE_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  return (
    <section className="points-panel" id="people" aria-labelledby="people-h">
      <h2 id="people-h">People</h2>
      <p>
        Public members and everyone with a recorded pull request, including
        people without a score yet.
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
      {census.state.status === "loading" ? (
        <p role="status">Loading contributors…</p>
      ) : census.state.status === "error" ? (
        <p role="status">
          Contributor records are unavailable.{" "}
          <button type="button" onClick={census.retry}>
            Retry contributors
          </button>
        </p>
      ) : null}
      {members.status === "preview" ? (
        <p>
          Public members load only on {new URL(browserDeployment.site).hostname}
          .{" "}
          <a href={`${browserDeployment.site}/points#people`}>
            View public members
          </a>
        </p>
      ) : members.status === "loading" ? (
        <p role="status">Loading members…</p>
      ) : members.status === "error" ? (
        <p role="status">
          Public members are unavailable.{" "}
          <button type="button" onClick={() => setAttempt((v) => v + 1)}>
            Retry members
          </button>
        </p>
      ) : null}
      {census.state.status === "ready" || members.status === "ready" ? (
        <>
          <p>{matches.length.toLocaleString()} people</p>
          <ul className="points-people">
            {matches
              .slice(
                current * PEOPLE_PAGE_SIZE,
                (current + 1) * PEOPLE_PAGE_SIZE,
              )
              .map((p) => {
                const earned =
                  state.status === "ready"
                    ? (state.members.find((m) => m.actor.id === p.id)?.total ??
                      0)
                    : null;
                const steward = PROJECTS.filter(
                  (project) =>
                    project.authority.state === "verified" &&
                    project.steward.github.nodeId === p.id,
                );
                const participation = p.member
                  ? p.member.welcome + p.member.socialPoints
                  : 0;
                return (
                  <li key={p.id}>
                    <a href={`/contributors/${encodeURIComponent(p.login)}`}>
                      {p.login}
                    </a>
                    <span>
                      {p.merged === null
                        ? "PR count unavailable"
                        : p.merged === 0
                          ? "No merged PRs"
                          : `${p.merged.toLocaleString()} merged PR${p.merged === 1 ? "" : "s"}`}
                    </span>
                    <span>
                      {earned === null
                        ? "Points unavailable"
                        : `${(earned + participation).toLocaleString()} pts`}
                    </span>
                    {p.member ? <small>Public member</small> : null}
                    {steward.length ? (
                      <small>
                        Project steward ·{" "}
                        {steward.map((s) => s.name).join(", ")}
                      </small>
                    ) : null}
                    {p.member?.x ? <XAccountLink account={p.member.x} /> : null}
                  </li>
                );
              })}
          </ul>
          {matches.length === 0 ? <p>No people match this username.</p> : null}
          <div className="points-controls">
            <button
              type="button"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              Previous people
            </button>
            <span>
              Page {current + 1} of {pages}
            </span>
            <button
              type="button"
              disabled={current + 1 >= pages}
              onClick={() => setPage(current + 1)}
            >
              Next people
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
