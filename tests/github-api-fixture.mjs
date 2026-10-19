/**
 * A loopback stand-in for the two public GitHub API reads the project
 * registry makes, so the registry browser lane is deterministic and never
 * spends GitHub's rate limit. The browser's own repository lookup is mocked
 * from the same facts.
 */
import { createServer } from "node:http";

/** The site session that owns its user repositories. */
export const E2E_OWNER = { githubId: "900000003", login: "e2e-owner" };
/** An organization whose members are never public. */
export const E2E_ORGANIZATION = { githubId: "987654320", login: "example" };

/** Deterministic public facts for a fixture repository. */
export function fixtureRepository(fullName) {
  const [ownerLogin, name] = fullName.split("/");
  const owner =
    ownerLogin === E2E_OWNER.login
      ? { login: E2E_OWNER.login, id: Number(E2E_OWNER.githubId), type: "User" }
      : {
          login: E2E_ORGANIZATION.login,
          id: Number(E2E_ORGANIZATION.githubId),
          type: "Organization",
        };
  let hash = 0;
  for (const character of fullName)
    hash = (hash * 31 + character.charCodeAt(0)) % 100_000;
  return {
    id: 123_400_000 + hash,
    node_id: `R_${fullName.replaceAll(/[^A-Za-z0-9]/gu, "_")}`,
    full_name: `${owner.login}/${name}`,
    description: "A reproducible research tool used by the registry tests.",
    private: false,
    default_branch: "main",
    owner: { ...owner, node_id: `O_${owner.login.replaceAll("-", "_")}` },
  };
}

export function startGitHubApiFixture(port) {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const repository = /^\/repos\/([^/]+\/[^/]+)$/u.exec(path);
    if (request.method === "GET" && repository) {
      const [owner] = repository[1].split("/");
      if (owner === E2E_OWNER.login || owner === E2E_ORGANIZATION.login) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(fixtureRepository(repository[1])));
        return;
      }
    }
    // Organization membership is private, so it is never proven.
    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"message":"Not Found"}');
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => resolve(server)),
  );
}
