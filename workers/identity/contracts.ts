export const IDENTITY_PUBLIC_ORIGIN = "https://identity.slop.cash";
export const IDENTITY_INTERNAL_HOST = "identity.internal";
export const IDENTITY_AUDIENCE = "private-trace-api";
export const POINTS_AUDIENCE = "slop-points-web";
export type IdentityAudience =
  | typeof IDENTITY_AUDIENCE
  | typeof POINTS_AUDIENCE;
export function isIdentityAudience(value: unknown): value is IdentityAudience {
  return value === IDENTITY_AUDIENCE || value === POINTS_AUDIENCE;
}
export const OAUTH_FLOW_TTL_SECONDS = 5 * 60;
export const ASSERTION_TTL_SECONDS = 90;
export const POLL_AFTER_SECONDS = 2;

export type OAuthFlowStatus =
  | "pending"
  | "callback_processing"
  | "callback_complete"
  | "assertion_issued";

export type OAuthFlow = {
  id: string;
  stateHash: string;
  pollCapabilityHash: string;
  encryptedPkceVerifier: string | null;
  pkceIv: string | null;
  audience: IdentityAudience;
  status: OAuthFlowStatus;
  githubActorId: string | null;
  githubLogin: string | null;
  githubNodeId?: string | null;
  createdAt: string;
  expiresAt: string;
  callbackCompletedAt: string | null;
  assertionIssuedAt: string | null;
};

export type IdentityAssertion = {
  tokenHash: string;
  githubActorId: string;
  githubLogin: string;
  githubNodeId?: string | null;
  audience: IdentityAudience;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
};

export interface IdentityPersistence {
  createFlow(flow: OAuthFlow): Promise<boolean>;
  findAuthorizableFlow(
    flowId: string,
    stateHash: string,
    now: string,
  ): Promise<OAuthFlow | null>;
  claimCallback(stateHash: string, now: string): Promise<OAuthFlow | null>;
  completeCallback(
    flowId: string,
    githubActorId: string,
    githubLogin: string,
    completedAt: string,
    githubNodeId?: string,
  ): Promise<boolean>;
  findPollableFlow(
    flowId: string,
    pollCapabilityHash: string,
    now: string,
  ): Promise<OAuthFlow | null>;
  createAssertion(
    assertion: IdentityAssertion,
  ): Promise<IdentityAssertion | null>;
  markAssertionIssued(flowId: string, issuedAt: string): Promise<boolean>;
  consumeAssertion(
    tokenHash: string,
    audience: string,
    now: string,
  ): Promise<IdentityAssertion | null>;
  deleteExpired(now: string): Promise<void>;
}
