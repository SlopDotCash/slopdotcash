import type {
  IdentityAssertion,
  IdentityPersistence,
  OAuthFlow,
} from "./contracts";

type D1Result = { success: boolean; meta?: { changes?: number } };
type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<D1Result>;
};

export type D1Database = {
  prepare(query: string): D1Statement;
};

type FlowRow = {
  id: string;
  state_hash: string;
  poll_capability_hash: string;
  encrypted_pkce_verifier: string | null;
  pkce_iv: string | null;
  audience: OAuthFlow["audience"];
  status: OAuthFlow["status"];
  github_actor_id: string | null;
  github_login: string | null;
  created_at: string;
  expires_at: string;
  callback_completed_at: string | null;
  assertion_issued_at: string | null;
};

type AssertionRow = {
  token_hash: string;
  github_actor_id: string;
  github_login: string;
  audience: IdentityAssertion["audience"];
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
};

function mapFlow(row: FlowRow): OAuthFlow {
  return {
    id: row.id,
    stateHash: row.state_hash,
    pollCapabilityHash: row.poll_capability_hash,
    encryptedPkceVerifier: row.encrypted_pkce_verifier,
    pkceIv: row.pkce_iv,
    audience: row.audience,
    status: row.status,
    githubActorId: row.github_actor_id,
    githubLogin: row.github_login,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    callbackCompletedAt: row.callback_completed_at,
    assertionIssuedAt: row.assertion_issued_at,
  };
}

function mapAssertion(row: AssertionRow): IdentityAssertion {
  return {
    tokenHash: row.token_hash,
    githubActorId: row.github_actor_id,
    githubLogin: row.github_login,
    audience: row.audience,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

export class D1IdentityPersistence implements IdentityPersistence {
  constructor(private readonly db: D1Database) {}

  async createFlow(flow: OAuthFlow): Promise<boolean> {
    try {
      await this.db
        .prepare(
          `INSERT INTO identity_oauth_flows (
            id, state_hash, poll_capability_hash, encrypted_pkce_verifier,
            pkce_iv, audience, status, github_actor_id, github_login,
            created_at, expires_at, callback_completed_at, assertion_issued_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL)`,
        )
        .bind(
          flow.id,
          flow.stateHash,
          flow.pollCapabilityHash,
          flow.encryptedPkceVerifier,
          flow.pkceIv,
          flow.audience,
          flow.status,
          flow.createdAt,
          flow.expiresAt,
        )
        .run();
      return true;
    } catch {
      return false;
    }
  }

  async findAuthorizableFlow(
    flowId: string,
    stateHash: string,
    now: string,
  ): Promise<OAuthFlow | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM identity_oauth_flows
         WHERE id = ? AND state_hash = ? AND status = 'pending' AND expires_at > ?`,
      )
      .bind(flowId, stateHash, now)
      .first<FlowRow>();
    return row === null ? null : mapFlow(row);
  }

  async claimCallback(
    stateHash: string,
    now: string,
  ): Promise<OAuthFlow | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM identity_oauth_flows
         WHERE state_hash = ? AND status = 'pending' AND expires_at > ?`,
      )
      .bind(stateHash, now)
      .first<FlowRow>();
    if (row === null) return null;
    const result = await this.db
      .prepare(
        `UPDATE identity_oauth_flows
         SET status = 'callback_processing', encrypted_pkce_verifier = NULL, pkce_iv = NULL
         WHERE id = ? AND status = 'pending' AND state_hash = ? AND expires_at > ?`,
      )
      .bind(row.id, stateHash, now)
      .run();
    return (result.meta?.changes ?? 0) === 1 ? mapFlow(row) : null;
  }

  async completeCallback(
    flowId: string,
    githubActorId: string,
    githubLogin: string,
    completedAt: string,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE identity_oauth_flows
         SET status = 'callback_complete', github_actor_id = ?, github_login = ?,
             callback_completed_at = ?
         WHERE id = ? AND status = 'callback_processing'`,
      )
      .bind(githubActorId, githubLogin, completedAt, flowId)
      .run();
    return (result.meta?.changes ?? 0) === 1;
  }

  async findPollableFlow(
    flowId: string,
    pollCapabilityHash: string,
    now: string,
  ): Promise<OAuthFlow | null> {
    const row = await this.db
      .prepare(
        `SELECT * FROM identity_oauth_flows
         WHERE id = ? AND poll_capability_hash = ? AND expires_at > ?`,
      )
      .bind(flowId, pollCapabilityHash, now)
      .first<FlowRow>();
    return row === null ? null : mapFlow(row);
  }

  async createAssertion(assertion: IdentityAssertion): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO identity_assertions (
          token_hash, github_actor_id, github_login, audience, created_at,
          expires_at, consumed_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL) ON CONFLICT(token_hash) DO NOTHING`,
      )
      .bind(
        assertion.tokenHash,
        assertion.githubActorId,
        assertion.githubLogin,
        assertion.audience,
        assertion.createdAt,
        assertion.expiresAt,
      )
      .run();
  }

  async markAssertionIssued(
    flowId: string,
    issuedAt: string,
  ): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE identity_oauth_flows
         SET status = 'assertion_issued', assertion_issued_at = ?
         WHERE id = ? AND status = 'callback_complete'`,
      )
      .bind(issuedAt, flowId)
      .run();
    return (result.meta?.changes ?? 0) === 1;
  }

  async consumeAssertion(
    tokenHash: string,
    audience: string,
    now: string,
  ): Promise<IdentityAssertion | null> {
    const result = await this.db
      .prepare(
        `UPDATE identity_assertions SET consumed_at = ?
         WHERE token_hash = ? AND audience = ? AND consumed_at IS NULL AND expires_at > ?`,
      )
      .bind(now, tokenHash, audience, now)
      .run();
    if ((result.meta?.changes ?? 0) !== 1) return null;
    const row = await this.db
      .prepare("SELECT * FROM identity_assertions WHERE token_hash = ?")
      .bind(tokenHash)
      .first<AssertionRow>();
    return row === null ? null : mapAssertion(row);
  }

  async deleteExpired(now: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM identity_oauth_flows WHERE expires_at <= ?")
      .bind(now)
      .run();
    await this.db
      .prepare("DELETE FROM identity_assertions WHERE expires_at <= ?")
      .bind(now)
      .run();
  }
}
