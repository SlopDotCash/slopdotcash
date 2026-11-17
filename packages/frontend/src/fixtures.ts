// spec/frontend/navigation.md, "A signed-out private destination keeps its URL and shows sign-in in place with private reads disabled"; spec/frontend/registry.md, "A page that acts on a project manifest needs a current registry and other pages show the last good registry labelled stale"
import type { RegistryFreshness } from "../gen/frontend__registry.ts";
import type { SessionView } from "./session/session.vibe";

export const sessions = {
  checking: { status: "checking" },
  signedOut: { status: "signedOut" },
  failed: { status: "failed", message: "The server returned an invalid project session. Retry sign-in." },
  member: { status: "signedIn", session: { githubId: "583231", githubLogin: "octocat", admin: false } },
  admin: { status: "signedIn", session: { githubId: "9919", githubLogin: "hubot", admin: true } },
} as const satisfies Record<string, SessionView>;

export const registries = {
  current: { tag: "RegistryCurrent" },
  stale: { tag: "RegistryStale", syncedAt: "2026-11-15T09:30:00Z" },
  failed: { tag: "RegistryFailed" },
} as const satisfies Record<string, RegistryFreshness>;

export const loginHref = "/login?next=%2Finbox%3Fcase%3D12";
