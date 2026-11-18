/** Read-only witness for the production Slopbot GitHub installation quota. */
import { createHash, createPrivateKey } from "node:crypto";
import { join } from "node:path";
import { githubHeaders } from "../backend/github";
import { appJwt } from "../workers/slopbot/github";

const api = "https://api.github.com";
const pageOnePath = "/installation/repositories?per_page=100&page=1";
const query =
  "query SlopValueReferenceRepository($owner:String!,$name:String!){repository(owner:$owner,name:$name){id isPrivate nameWithOwner} rateLimit{cost limit remaining resetAt}}";

function check(condition: unknown): asserts condition {
  if (!condition) throw new Error("quota witness refused");
}

function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

type CoreBudget = {
  limit: number;
  remaining: number;
  used: number;
  reset: number;
};
type RegistryRevision = {
  manifestSha256: string;
  project: {
    id: string;
    status: string;
    authority: { repositoryId: string; repositoryNodeId: string };
    repositories: { id: string }[];
  };
};
type Repository = {
  id: number;
  node_id: string;
  private: boolean;
  full_name: string;
};
type Installation = { id: number; app_id: number };
type Token = { token: string; expires_at: string };
type InstallRepositories = { total_count: number; repositories: Repository[] };
type GraphqlResponse = {
  errors?: unknown[];
  data: {
    repository: { id: string; isPrivate: boolean; nameWithOwner: string };
    rateLimit: {
      cost: number;
      limit: number;
      remaining: number;
      resetAt: string;
    };
  };
};

function budget(value: CoreBudget | undefined) {
  check(integer(value?.limit) && value.limit > 0);
  check(
    integer(value?.remaining) && integer(value.used) && integer(value.reset),
  );
  check(value.used + value.remaining === value.limit && value.reset > 0);
  return {
    limit: value.limit,
    remaining: value.remaining,
    used: value.used,
    reset: value.reset,
  };
}

async function read<T>(
  path: string,
  token: string,
  method = "GET",
  body?: unknown,
  fetchImpl = fetch,
) {
  const headers = new Headers(githubHeaders(token, "slopbot"));
  if (body !== undefined) headers.set("content-type", "application/json");
  const response = await fetchImpl(api + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  check(response.ok);
  return { response, value: (await response.json()) as T };
}

export async function observe(
  env: NodeJS.ProcessEnv,
  fetchImpl = fetch,
  sign = appJwt,
) {
  const project = env.SLOP_QUOTA_PROJECT ?? "";
  const manifestSha256 = env.SLOP_QUOTA_MANIFEST_SHA256 ?? "";
  const planSha256 = env.SLOP_QUOTA_PLAN_SHA256 ?? "";
  const appId = env.SLOPBOT_APP_ID ?? "";
  check(/^[a-z0-9][a-z0-9-]{0,63}$/u.test(project));
  check(
    /^[a-f0-9]{64}$/u.test(manifestSha256) &&
      /^[a-f0-9]{64}$/u.test(planSha256),
  );
  check(/^[1-9][0-9]{0,15}$/u.test(appId));

  const registry = await fetchImpl(
    `https://slop.cash/api/v1/projects/${project}`,
    {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    },
  );
  check(registry.ok);
  const revision = (await registry.json()) as RegistryRevision;
  check(
    revision.manifestSha256 === manifestSha256 &&
      revision.project?.id === project,
  );
  const current = revision.project;
  check(current.status === "active");
  check(
    createHash("sha256").update(JSON.stringify(current)).digest("hex") ===
      manifestSha256,
  );
  const cleanPath: string = current.repositories?.[0]?.id;
  const repositoryId = Number(current.authority?.repositoryId);
  const nodeId = current.authority?.repositoryNodeId;
  check(
    typeof cleanPath === "string" &&
      /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u.test(cleanPath),
  );
  check(
    integer(repositoryId) &&
      repositoryId > 0 &&
      typeof nodeId === "string" &&
      nodeId.length > 0,
  );

  const key = env.SLOPBOT_APP_PRIVATE_KEY;
  check(typeof key === "string" && key.length > 0);
  const pem = createPrivateKey(key)
    .export({ format: "pem", type: "pkcs8" })
    .toString();
  const jwt = await sign(appId, pem);
  const get = <T>(path: string, token: string) =>
    read<T>(path, token, "GET", undefined, fetchImpl);
  const installation = (
    await get<Installation>(`/repos/${cleanPath}/installation`, jwt)
  ).value;
  check(
    integer(installation.id) &&
      installation.id > 0 &&
      String(installation.app_id) === appId,
  );
  const minted = (
    await read<Token>(
      `/app/installations/${installation.id}/access_tokens`,
      jwt,
      "POST",
      undefined,
      fetchImpl,
    )
  ).value;
  check(
    typeof minted.token === "string" &&
      minted.token.length > 0 &&
      Date.parse(minted.expires_at) > Date.now() + 60_000,
  );
  const token = minted.token;
  const snapshot = budget(
    (await get<{ resources?: { core?: CoreBudget } }>("/rate_limit", token))
      .value.resources?.core,
  );
  const { value: page } = await get<InstallRepositories>(pageOnePath, token);
  check(integer(page.total_count) && Array.isArray(page.repositories));
  check(
    page.repositories.length > 0 &&
      page.repositories.length <= 100 &&
      page.total_count >= page.repositories.length,
  );
  const matchRepository = (repository: Repository) =>
    repository.id === repositoryId &&
    repository.node_id === nodeId &&
    repository.private === false &&
    typeof repository.full_name === "string" &&
    repository.full_name.toLowerCase() === cleanPath.toLowerCase();
  check(page.repositories.filter(matchRepository).length === 1);
  const { response, value: repository } = await get<Repository>(
    `/repos/${cleanPath}`,
    token,
  );
  check(matchRepository(repository));
  const header = (part: string) => {
    const value = response.headers.get(`x-ratelimit-${part}`);
    check(typeof value === "string" && /^[0-9]{1,16}$/u.test(value));
    return Number(value);
  };
  const currentBudget = budget({
    limit: header("limit"),
    remaining: header("remaining"),
    used: header("used"),
    reset: header("reset"),
  });
  const resetDeltaSeconds = currentBudget.reset - snapshot.reset;
  const usedDelta = currentBudget.used - snapshot.used;
  const remainingDelta = snapshot.remaining - currentBudget.remaining;
  check(
    currentBudget.limit === snapshot.limit &&
      Math.abs(resetDeltaSeconds) <= 1 &&
      usedDelta >= 2 &&
      usedDelta === remainingDelta,
  );
  const [owner, name] = cleanPath.split("/");
  const data = (
    await read<GraphqlResponse>(
      "/graphql",
      token,
      "POST",
      { query, variables: { owner, name } },
      fetchImpl,
    )
  ).value;
  check(
    !data.errors?.length &&
      data.data?.repository?.id === nodeId &&
      data.data.repository.isPrivate === false,
  );
  check(
    data.data.repository.nameWithOwner?.toLowerCase() ===
      cleanPath.toLowerCase(),
  );
  const graph = data.data.rateLimit;
  check(
    integer(graph.cost) &&
      integer(graph.limit) &&
      integer(graph.remaining) &&
      graph.remaining <= graph.limit,
  );
  check(Number.isFinite(Date.parse(graph.resetAt)));
  return {
    schemaVersion: "protected-slopbot-app-quota:v1",
    checkedAt: new Date().toISOString(),
    project,
    manifestSha256,
    planSha256,
    appId,
    installationId: installation.id,
    repository: { path: cleanPath, databaseId: repositoryId, nodeId },
    installationPageOne: {
      path: pageOnePath,
      pageCount: page.repositories.length,
      totalCount: page.total_count,
      matched: true,
      checkedWithQuotaToken: true,
    },
    tokenExpiresAt: minted.expires_at,
    core: snapshot,
    restProbe: currentBudget,
    effectiveCore: currentBudget,
    restBudgetConsistent: true,
    resetDeltaSeconds,
    usedDelta,
    remainingDelta,
    graphqlValid: true,
    graphql: {
      cost: graph.cost,
      limit: graph.limit,
      remaining: graph.remaining,
      resetAt: graph.resetAt,
    },
    productionWrites: false,
  };
}

if (import.meta.main) {
  try {
    check(process.env.RUNNER_TEMP);
    const witness = await observe(process.env);
    await Bun.write(
      join(process.env.RUNNER_TEMP, "slopbot-app-quota.json"),
      `${JSON.stringify(witness)}\n`,
    );
  } catch {
    console.error("Protected GitHub App quota witness was refused");
    process.exitCode = 1;
  }
}
