import { ArrowDown, ChevronDown } from "lucide-react";
import {
  createContext,
  lazy,
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
import { AccountAppeals } from "./AccountAppeals";
import { Link } from "./Link";
import {
  browserDeployment,
  localBackendOrigin,
  loginHref,
} from "./lib/browser-deployment";
import {
  fetchWithDeadline,
  readBoundedJson,
  readBoundedText,
} from "./lib/browser-json";
import { CONTACT_MAILTO } from "./lib/contact";
import { contributorStandings } from "./lib/contributor-standings";
import type { CycleIndex } from "./lib/cycle-index";
import { deploymentTier } from "./lib/deployment";
import { errorMessage } from "./lib/errors";
import { GithubIcon } from "./lib/github-icon";
import { requestIdentityAssertion } from "./lib/identity-flow";
import { clearAllDrafts } from "./lib/intake-drafts";
import type { ActorRef } from "./lib/leaderboard-types";
import {
  clearLocalFlow,
  readLocalFlow,
  saveLocalFlow,
} from "./lib/local-signin";
import {
  assemblePoints,
  POINTS_NOTICE,
  type PointsIndex,
  type PointsJournal,
  type PointsMember,
  pointMembers,
} from "./lib/points";
import { recentPoints } from "./lib/profile-activity";
import { profileCounts } from "./lib/profiles";
import { useProjectSession } from "./lib/project-api";
import { findProject, PROJECTS } from "./lib/projects.mjs";
import { useAction } from "./lib/use-action";
import { useAllDirectTransfers } from "./lib/use-direct-transfers";
import { type DataState, useSnapshot } from "./lib/use-snapshot";
import {
  DataNotice,
  formatDateTime,
  formatMicroUsdc,
  NotFound,
  Pager,
} from "./Presentation";
import { ProfileActivity, useProfiles } from "./Profiles";

const EarningsPage = lazy(() =>
  import("./Earnings").then((module) => ({ default: module.EarningsPage })),
);

const productOrigin = () =>
  browserDeployment.browserOrigins.has(window.location.origin);

function AdminAccountLink({ onNavigate }: { onNavigate: () => void }) {
  const session = useProjectSession();
  if (session.status !== "signed-in" || !session.session.admin) return null;
  return (
    <Link href="/admin" onNavigate={onNavigate}>
      Admin
    </Link>
  );
}

interface Membership {
  actor: ActorRef;
  joinedAt: string;
  public: boolean;
  welcome: number;
  socialPoints?: number;
}
type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; journal: PointsJournal; members: PointsMember[] };
type PointsContext = {
  state: State;
  me: Membership | null;
  session: "loading" | "ready" | "error";
  refresh: () => void;
  requestPoints: () => void;
  setMe: (m: Membership | null) => void;
};
const Context = createContext<PointsContext | null>(null);
/** The points state of the enclosing PointsProvider; there is no default. */
function usePoints(): PointsContext {
  const value = useContext(Context);
  if (!value) throw new Error("PointsProvider is missing");
  return value;
}
/** A refused points request with the server's stable error code, if any. */
class PointsRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`Points request returned ${status}`);
  }
}
async function requestJson(url: string, init: RequestInit = {}) {
  const response = await fetchWithDeadline(url, {
    ...init,
    cache: "no-store",
  });
  if (!response.ok) {
    let code: string | null = null;
    try {
      const body = await readBoundedJson(response, 4096, "points error");
      const error = (body as { error?: unknown } | null)?.error;
      if (typeof error === "string") code = error;
    } catch {
      // The status alone still describes the refusal.
    }
    throw new PointsRequestError(response.status, code);
  }
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
function returnPath(search = window.location.search): string | null {
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
    ![0, 5].includes(m.welcome) ||
    (m.socialPoints !== undefined && ![0, 10].includes(m.socialPoints)) ||
    typeof m.public !== "boolean" ||
    !Number.isFinite(Date.parse(m.joinedAt))
  )
    throw new Error("Invalid points membership");
  return m;
}
export function PointsProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
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
            message: "Points could not load.",
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

export function PointsNav() {
  const { state, me, session, setMe, requestPoints, refresh } = usePoints();
  const [open, setOpen] = useState(false);
  const [failedImage, setFailedImage] = useState("");
  const { busy, error, run } = useAction();
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
  const navigate = () => setOpen(false);
  function signout() {
    void run(
      async () => {
        await requestJson("/api/v1/points/signout", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        clearAllDrafts();
        setMe(null);
        setOpen(false);
      },
      () => "Could not sign out. Retry.",
    );
  }
  if (!me && window.location.pathname === "/login") return null;
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
        href={loginHref(
          window.location.pathname === "/login" ? "/" : loginReturn,
        )}
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
          if (!open) requestPoints();
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
          <a href="/inbox" onClick={navigate}>
            Inbox
          </a>
          <a href="/earnings" onClick={navigate}>
            Payouts
          </a>
          <Link href="/account#wallets" onNavigate={navigate}>
            Wallets
          </Link>
          <a href="/account" onClick={navigate}>
            Account settings
          </a>
          <AdminAccountLink onNavigate={navigate} />
          <button type="button" onClick={signout} disabled={busy}>
            {busy ? "Signing out…" : "Sign out"}
          </button>
          {error ? <p role="alert">{error}</p> : null}
        </section>
      ) : null}
    </div>
  );
}

function Notice() {
  const { state, refresh } = usePoints();
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
  return null;
}
/** Current membership identity, shared with the profile's history and wallet lookup. */
export function useProfileMembership(login: string, enabled = true) {
  const { me, session } = usePoints();
  const normalizedLogin = login.toLowerCase();
  const [lookup, setLookup] = useState<{
    login: string;
    status: "loading" | "unavailable" | "absent" | "ready";
    member: Membership | null;
  }>({ login: normalizedLogin, status: "loading", member: null });
  useEffect(() => {
    if (!enabled) return;
    const c = new AbortController();
    const update = (
      status: typeof lookup.status,
      value: Membership | null = null,
    ) => {
      if (!c.signal.aborted)
        setLookup({ login: normalizedLogin, status, member: value });
    };
    update("loading");
    if (!productOrigin()) {
      update("unavailable");
      return () => c.abort();
    }
    void fetch(`/api/v1/points/member?login=${encodeURIComponent(login)}`, {
      signal: c.signal,
    })
      .then(async (r) => {
        if (r.status === 404) {
          update("absent");
          return;
        }
        if (!r.ok) throw new Error("unavailable");
        const value = await readBoundedJson(r, 16384, "member");
        update(value ? "ready" : "absent", value ? member(value) : null);
      })
      .catch(() => update("unavailable"));
    return () => c.abort();
  }, [enabled, login, normalizedLogin]);
  const signedInActor = session === "ready" ? me?.actor : undefined;
  const own =
    signedInActor?.login.toLowerCase() === normalizedLogin ? me : null;
  const current = lookup.login === normalizedLogin ? lookup : null;
  return {
    own,
    signedInActor,
    sessionStatus: session,
    joined: current?.member ?? null,
    joinStatus: current?.status ?? "loading",
  };
}

/** The profile shows points earned over this many recent days beside the total. */
const RECENT_POINTS_DAYS = 30;

export function ProfilePoints({
  actorId,
  login,
  cycles,
  showIdentity = false,
  notFoundWhenUnrecorded = false,
  profileCensus,
  profileMembership,
  children,
}: {
  children?: ReactNode;
  login: string;
  cycles?: CycleIndex;
  showIdentity?: boolean;
  actorId?: string;
  /** The caller found no score record, so no points record means no contributor. */
  notFoundWhenUnrecorded?: boolean;
  profileCensus?: ReturnType<typeof useProfiles>;
  profileMembership?: ReturnType<typeof useProfileMembership>;
}) {
  const { state } = usePoints();
  const localCensus = useProfiles(!profileCensus);
  const census = profileCensus ?? localCensus;
  const censusMatches =
    census.state.status === "ready"
      ? census.state.index.people.filter((p) =>
          actorId
            ? p.id === actorId
            : p.login.toLowerCase() === login.toLowerCase(),
        )
      : [];
  const recorded = censusMatches.length === 1 ? censusMatches[0] : undefined;
  const localMembership = useProfileMembership(login, !profileMembership);
  const { own, joined, joinStatus } = profileMembership ?? localMembership;
  const named =
    state.status === "ready"
      ? state.members.filter(
          (m) => m.actor.login.toLowerCase() === login.toLowerCase(),
        )
      : [];
  const membership =
    own ??
    (joined?.actor.login.toLowerCase() === login.toLowerCase() ? joined : null);
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
  // A known actor with no Points record and no membership has none.
  const pointsKnown =
    state.status === "ready" &&
    (m || identity || recorded || (actorId && joinStatus === "absent"));
  const pointsUnavailable = pointsKnown
    ? null
    : state.status === "loading"
      ? "Loading…"
      : "Unavailable";
  if (
    notFoundWhenUnrecorded &&
    state.status === "ready" &&
    census.state.status === "ready" &&
    joinStatus === "absent" &&
    !own &&
    !m &&
    !recorded &&
    named.length === 0
  )
    return (
      <NotFound as="section" title="Contributor not found">
        <p>Slop has no public record for {login}.</p>
      </NotFound>
    );
  return (
    <section className="points-panel" aria-label="Slop Points">
      <ProfileActivity
        awards={m?.awards}
        login={login}
        actorId={resolvedActorId ?? m?.actor.id}
        census={census}
        cycles={cycles}
        showIdentity={showIdentity}
        badges={
          <>
            <Notice />
            {state.status === "ready" && (m || identity || recorded) ? (
              <div className="profile-badges">
                <PublicXLink
                  actorId={(m?.actor ?? identity?.actor ?? recorded!).id}
                />
              </div>
            ) : state.status === "ready" ? (
              <p>
                {joinStatus === "loading"
                  ? "Looking up membership…"
                  : joinStatus === "unavailable"
                    ? "Membership could not load."
                    : "No recorded points yet."}
              </p>
            ) : null}
          </>
        }
        summary={
          <>
            <div>
              <strong>
                {pointsUnavailable ??
                  recentPoints(
                    m?.awards ?? [],
                    new Date(),
                    RECENT_POINTS_DAYS,
                  ).toLocaleString()}
              </strong>
              <span>points · {RECENT_POINTS_DAYS} days</span>
            </div>
            <div>
              <strong>
                {pointsUnavailable ??
                  (
                    (m?.total ?? 0) +
                    (identity?.welcome ?? 0) +
                    (identity?.socialPoints ?? 0)
                  ).toLocaleString()}
              </strong>
              <span>total points</span>
            </div>
          </>
        }
      >
        {children}
      </ProfileActivity>
    </section>
  );
}
function JoinPoints({ showHeading = true }: { showHeading?: boolean }) {
  const { me, setMe, session } = usePoints();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [closedAccount, setClosedAccount] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  // Local development: finish a same-tab sign-in when GitHub sends the browser back.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once the session check settles
  useEffect(() => {
    if (localBackendOrigin === null || me || session !== "ready") return;
    const saved = readLocalFlow();
    if (!saved) return;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${saved.search}`,
    );
    void start(saved.reopen, saved.flow);
  }, [me, session]);
  async function start(reopen = false, resume?: unknown) {
    active.current?.abort();
    // A flow that GitHub already completed needs no window.
    let popup: Window | null = null;
    if (resume === undefined) {
      popup = window.open(
        "about:blank",
        "_blank",
        "popup,width=600,height=720",
      );
      if (!popup && localBackendOrigin === null) {
        // Some browsers, including embedded ones, never open the window; without
        // it the sign-in would wait for a GitHub page nobody can see.
        setBusy(false);
        setMessage(
          "Your browser did not open the GitHub sign-in window. Allow pop-ups for this site, or open it in another browser, and try again.",
        );
        return;
      }
      if (popup) popup.opener = null;
    }
    // Only a local backend signs in in this tab when no window opens.
    const sameTab = resume === undefined && popup === null;
    const c = new AbortController();
    active.current = c;
    setBusy(true);
    setMessage("");
    try {
      const assertion = await requestIdentityAssertion({
        origin: identityPublicOrigin(
          // A local backend serves sign-in from the dev server's own origin.
          localBackendOrigin ??
            ([
              "https://staging.slop.cash",
              "https://slop-staging.pages.dev",
            ].includes(window.location.origin)
              ? import.meta.env.VITE_IDENTITY_PUBLIC_ORIGIN
              : undefined),
          deploymentTier(import.meta.env.VITE_SLOP_ENVIRONMENT),
          { loopback: localBackendOrigin !== null },
        ),
        allowLoopback: localBackendOrigin !== null,
        audience: "slop-points-web",
        signal: c.signal,
        resume,
        saveAuthorization:
          localBackendOrigin === null
            ? undefined
            : (value) => {
                if (value === null) clearLocalFlow();
                else if (sameTab) saveLocalFlow(value, reopen);
              },
        authorize: (url) =>
          sameTab ? window.location.assign(url) : popup?.location.replace(url),
        request: async (url, init) => {
          const response = await fetchWithDeadline(url, {
            ...init,
            signal: c.signal,
            credentials: "omit",
            redirect: "error",
            cache: "no-store",
            referrerPolicy: "no-referrer",
          });
          if (!response.ok) throw new Error("Sign-in expired. Start again.");
          const body = await readBoundedJson(response, 16384, "sign-in");
          if (!body || typeof body !== "object" || Array.isArray(body))
            throw new Error("Sign-in failed. Start again.");
          return {
            status: response.status,
            body: body as Record<string, unknown>,
          };
        },
      });
      const joined = await requestJson("/api/v1/points/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          reopen
            ? { assertion, public: true, reopen: true }
            : { assertion, public: true },
        ),
        signal: c.signal,
      });
      setClosedAccount(false);
      setMe(member(joined));
      setMessage(
        reopen
          ? "Your account is open again. Connections and activity email are off."
          : "You’re signed in.",
      );
    } catch (e) {
      if (c.signal.aborted) return;
      if (localBackendOrigin !== null) clearLocalFlow();
      if (e instanceof PointsRequestError && e.code === "account_closed") {
        setClosedAccount(true);
        setMessage("You closed this account. Reopen it to sign in.");
      } else
        setMessage(
          e instanceof TypeError
            ? "Could not reach Slop. Try again."
            : errorMessage(e, "Sign-in unavailable"),
        );
    } finally {
      if (active.current === c) setBusy(false);
    }
  }
  if (!productOrigin()) {
    const destination = new URL("/login", browserDeployment.site);
    const next = returnPath();
    if (next) destination.searchParams.set("next", next);
    return (
      <section className="points-panel">
        {showHeading ? <h2>Sign in to Slop</h2> : null}
        <a
          className="button primary-button"
          href={destination.href}
          aria-label={`Continue with GitHub on ${new URL(browserDeployment.site).hostname}`}
        >
          <GithubIcon aria-hidden="true" />
          Continue with GitHub
        </a>
      </section>
    );
  }
  // The header account menu offers the profile link and sign out.
  if (me) return null;
  return (
    <section className="points-panel">
      {showHeading ? <h2>Sign in to Slop</h2> : null}
      {session === "error" ? (
        <p role="status">Could not check your session. Sign in again.</p>
      ) : null}
      <button
        className="button primary-button"
        type="button"
        disabled={busy || session === "loading"}
        onClick={() => void start(closedAccount)}
      >
        <GithubIcon aria-hidden="true" />
        {busy
          ? "Waiting for GitHub…"
          : closedAccount
            ? "Reopen account with GitHub"
            : "Continue with GitHub"}
      </button>
      <p role="status">{message}</p>
    </section>
  );
}
export function LoginPage() {
  const { me } = usePoints();
  useEffect(() => {
    if (me)
      window.location.replace(
        returnPath() ?? `/contributors/${encodeURIComponent(me.actor.login)}`,
      );
  }, [me]);
  return (
    <main className="shell route-main login-page">
      <h1>{me ? "Signed in" : "Log in"}</h1>
      {me ? (
        <p role="status">Redirecting…</p>
      ) : (
        <JoinPoints showHeading={false} />
      )}
    </main>
  );
}
export function AccountPage() {
  const accountSession = useProjectSession();
  const { me, session } = usePoints();
  // Signed in, the header account menu covers the profile link and sign out.
  const signedOut = !me && session !== "loading";
  return (
    <main className="shell route-main points-page">
      <h1>Account</h1>
      <nav className="account-sections" aria-label="Account sections">
        {signedOut ? <a href="#profile">Sign in</a> : null}
        {me ? <a href="#connections">Connections</a> : null}
        <a href="#wallets">Wallets</a>
        <a href="/earnings">Payouts</a>
        <a href="/inbox">Inbox</a>
        {accountSession.status === "signed-in" ? (
          <a href="#appeals">Appeals</a>
        ) : null}
        {signedOut ? <a href="#recovery">Recovery</a> : null}
      </nav>
      {signedOut ? (
        <div id="profile">
          <JoinPoints />
        </div>
      ) : null}
      <div id="connections">
        <SocialConnections />
      </div>
      {session === "loading" ? (
        <section id="wallets">
          <h2>Wallets</h2>
          <p role="status">Checking your account…</p>
        </section>
      ) : (
        <EarningsPage walletsOnly key={me?.actor.id ?? "signed-out"} />
      )}
      {accountSession.status === "signed-in" ? <AccountAppeals /> : null}
      {signedOut ? (
        <section id="recovery">
          <h2>Recovery</h2>
          <p>
            Lost access to your account?{" "}
            <a href={`${CONTACT_MAILTO}?subject=Account%20recovery`}>
              Request private account recovery
            </a>
            .
          </p>
        </section>
      ) : null}
    </main>
  );
}
/** Categories from protocol/points-v1.md: activity and points. */
const POINT_CATEGORIES: readonly (readonly [string, string])[] = [
  [
    "Accepted work: micro, small, medium, large, XL, exceptional",
    "10 · 30 · 90 · 240 · 450 · 750",
  ],
  ["Reviews: triage, standard, deep, specialist", "10 · 30 · 90 · 240"],
  ["Merged PR before scoring began", "10 each"],
  ["Verified payout", "25 per project and month"],
];
export function PointsPage() {
  return (
    <main className="shell route-main points-page">
      <h1>Leaderboard</h1>
      <ContributorStandings />
      <section className="points-panel" id="rules">
        <h2>Ways to earn Points</h2>
        <p>{POINTS_NOTICE}</p>
        <ul aria-label="Point categories" className="points-rules">
          {POINT_CATEGORIES.map(([activity, points]) => (
            <li key={activity}>
              <span>{activity}</span>
              <strong>{points}</strong>
            </li>
          ))}
        </ul>
        <a href="/protocol/points-v1.md">Read the points rules</a> ·{" "}
        <a href="/data/points.json" download>
          Download points index
        </a>
      </section>
      <People />
    </main>
  );
}
const countFormat = new Intl.NumberFormat("en-US");

/** The bounds and source counts the published snapshot states, verbatim. */
function StandingsCoverage({
  state,
  month,
  projectId,
}: {
  state: Extract<DataState, { status: "ready" }>;
  /** The ranked UTC month, or null for recorded history. */
  month: string | null;
  projectId: string;
}) {
  const { snapshot, cycleIndex } = state;
  const { counts } = snapshot.source;
  const closedCycles = cycleIndex.cycles.filter(
    (cycle) => !projectId || cycle.projectId === projectId,
  ).length;
  // "This month" ranks only the snapshot entries inside the UTC month, so its
  // exact period starts at the later of the month start and the window start.
  const monthStart = month === null ? null : `${month}-01T00:00:00.000Z`;
  const rankedFrom =
    monthStart === null
      ? null
      : Date.parse(monthStart) > Date.parse(snapshot.window.from)
        ? monthStart
        : snapshot.window.from;
  return (
    <p className="points-meta points-coverage">
      {rankedFrom !== null &&
      Date.parse(rankedFrom) < Date.parse(snapshot.window.to)
        ? `This month ranks ${formatDateTime(rankedFrom)} to ${formatDateTime(snapshot.window.to)}. `
        : null}
      Snapshot window: {formatDateTime(snapshot.window.from)} to{" "}
      {formatDateTime(snapshot.window.to)}. Source
      {projectId ? " (all projects)" : ""}:{" "}
      {countFormat.format(counts.mergedPullRequests)} merged pull requests and{" "}
      {countFormat.format(counts.closedIssues)} closed issues across{" "}
      {countFormat.format(snapshot.repositories.length)} repositories.
      {month === null
        ? ` Includes ${countFormat.format(closedCycles)} closed ${closedCycles === 1 ? "cycle" : "cycles"}.`
        : null}
    </p>
  );
}

export function ContributorStandings({
  scoreState,
  retryScore,
  projectId,
  compact = false,
  title,
  showDataNotice = !scoreState,
}: {
  projectId?: string;
  compact?: boolean;
  title?: string;
  scoreState?: DataState;
  retryScore?: () => void;
  /** Shows score loading, error and stale states for a caller's shared read. */
  showDataNotice?: boolean;
}) {
  const [loadedScore, retryLoadedScore] = useSnapshot(!scoreState);
  const scores = scoreState ?? loadedScore;
  const readFilters = useCallback(() => {
    const params = new URLSearchParams(window.location.search);
    const sort = params.get("sort");
    const period = params.get("period");
    // `period=new` was an earlier link to recorded history.
    return {
      sort: sort === "money" ? ("money" as const) : ("points" as const),
      period: period === "lifetime" || period === "new" ? "lifetime" : "month",
      query: params.get("q") ?? "",
      project: projectId ?? findProject(params.get("project") ?? "")?.id ?? "",
      page: Math.max(
        0,
        Number.parseInt(params.get("page") ?? "1", 10) - 1 || 0,
      ),
    };
  }, [projectId]);
  const [filters, setFilters] = useState(readFilters);
  const { sort, period, query, page } = filters;
  const project = projectId ?? filters.project;
  const setSort = (sort: "points" | "money") =>
    setFilters((v) => ({ ...v, sort, page: 0 }));
  const setPeriod = (period: string) =>
    setFilters((v) => ({ ...v, period, page: 0 }));
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
      sort: sort === "points" ? "" : sort,
      period: period === "month" ? "" : period,
      q: query,
      project: projectId ? "" : project,
      page: page ? String(page + 1) : "",
    })) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState(window.history.state, "", url);
  }, [sort, period, query, project, page, projectId]);
  const { state } = usePoints();
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
  ) => (sort === "points" ? m.points : m.money);
  const [direct, retryDirect] = useAllDirectTransfers(
    PROJECTS.map((p) => p.id),
  );
  const projection = contributorStandings(
    scores,
    state.status === "ready" ? members : null,
    period === "month" ? new Date().toISOString().slice(0, 7) : null,
    project,
    direct.status === "ready" ? direct.transfers : null,
  );
  // Loading and failed sources stay distinct in each column.
  const pointsMissing = state.status === "loading" ? "Loading…" : "Unavailable";
  const moneyMissing =
    scores.status === "loading" || direct.status === "loading"
      ? "Loading…"
      : "Unavailable";
  const ranked = projection.rows
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
      ((m.points ?? 0) > 0 || (m.money ?? 0n) > 0n) &&
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
      {compact ? <h2>{title ?? "Contributor standings"}</h2> : null}
      {showDataNotice ? (
        <DataNotice state={scores} retry={retryScore ?? retryLoadedScore} />
      ) : null}
      <Notice />
      {!compact && direct.status === "error" ? (
        <p role="status">
          <span>Payment records unavailable.</span>{" "}
          <button type="button" onClick={retryDirect}>
            Retry payment records
          </button>
        </p>
      ) : !compact && direct.status === "loading" && sort === "money" ? (
        <p role="status">Loading payment records…</p>
      ) : null}
      {!compact ? (
        <div className="points-controls">
          <fieldset className="points-period">
            <legend>Period</legend>
            {(
              [
                ["month", "This month (UTC)"],
                ["lifetime", "Lifetime"],
              ] as const
            ).map(([value, label]) => (
              <button
                aria-pressed={period === value}
                key={value}
                onClick={() => setPeriod(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </fieldset>
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
      ) : null}
      {!compact && scores.status === "ready" ? (
        <StandingsCoverage
          month={
            period === "month" ? new Date().toISOString().slice(0, 7) : null
          }
          projectId={project}
          state={scores}
        />
      ) : null}
      {(
        sort === "points"
          ? state.status === "ready"
          : scores.status === "ready"
      ) ? (
        <>
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
                    </th>
                  ))}
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
                        {m.points === null
                          ? pointsMissing
                          : `${m.points.toLocaleString()} pts`}
                      </td>
                      <td className="points-value">
                        {m.money === null
                          ? moneyMissing
                          : formatMicroUsdc(m.money.toString())}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
          {rows.length === 0 &&
          (sort !== "money" || projection.moneyAvailable) ? (
            <p>No contributors match this view.</p>
          ) : null}
          {rows.length > pageSize ? (
            <Pager
              onPage={setPage}
              page={currentPage}
              pages={Math.ceil(rows.length / pageSize)}
            />
          ) : null}
        </>
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
function PublicXLink({ actorId }: { actorId: string }) {
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
  const { me, setMe } = usePoints();
  const [data, setData] = useState<{
    configured: boolean;
    account: (XAccount & { public: number }) | null;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: version explicitly refreshes the server state after account mutations.
  useEffect(() => {
    setData(null);
    if (!me || !productOrigin()) return;
    const c = new AbortController();
    void requestJson("/api/v1/points/x/me", { signal: c.signal })
      .then((value) => {
        const v = value as NonNullable<typeof data>;
        if (
          typeof v.configured !== "boolean" ||
          (v.account && ![0, 1].includes(v.account.public))
        )
          throw new Error("Invalid connection state");
        if (v.account) xAccount(v.account);
        setData(v);
      })
      .catch(() => {
        if (!c.signal.aborted) setMessage("X details unavailable.");
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
      setMessage("X disconnected.");
    } catch {
      setMessage("X request failed. Retry.");
    } finally {
      setBusy(false);
    }
  }
  if (!me) return null;
  return (
    <section className="points-panel" aria-label="Connections">
      <h2>Connections</h2>
      {outcome === "connected" ? (
        <p role="status">X connected.</p>
      ) : outcome === "cancelled" ? (
        <p role="status">X connection cancelled.</p>
      ) : outcome === "failed" ? (
        <p role="status">
          X could not be connected. An X account linked to another member cannot
          be reused.
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
                onClick={() => void action("start", { public: true })}
              >
                {busy ? "Connecting…" : "Connect X"}
              </button>
            ) : (
              <span>Unavailable</span>
            )}
          </div>
          {data.account && !me.public ? (
            <p>Hidden while your membership is private.</p>
          ) : null}
          <p role="status">{message}</p>
        </>
      )}
    </section>
  );
}
type Person = {
  actor: ActorRef;
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
    ![0, 5].includes(p.welcome) ||
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
  const { state, me } = usePoints();
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
          Contributors unavailable.{" "}
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
          Members unavailable.{" "}
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
                        Project maintainer ·{" "}
                        {steward.map((s) => s.name).join(", ")}
                      </small>
                    ) : null}
                    {p.member?.x ? <XAccountLink account={p.member.x} /> : null}
                  </li>
                );
              })}
          </ul>
          {matches.length === 0 ? <p>No matches.</p> : null}
          <Pager noun="people" onPage={setPage} page={current} pages={pages} />
        </>
      ) : null}
    </section>
  );
}
