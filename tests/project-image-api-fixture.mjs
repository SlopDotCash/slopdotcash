import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { unstable_splitSqlQuery as splitSqlQuery } from "wrangler";
import { childEnvironment } from "../scripts/child-environment.mjs";

/** Real project API and native D1; fixture maintainer authority, no provider. */
export async function projectImageApiFixture(project, options = {}) {
  const folder = await mkdtemp(join(tmpdir(), "slop-project-image-"));
  let runtime;
  try {
    const entry = join(folder, "worker.ts");
    const output = join(folder, "worker.mjs");
    const repository = project.repositories[0];
    const actor = { githubId: "4242", githubLogin: "image-fixture-owner" };
    const facts = {
      id: Number(project.authority.repositoryId),
      node_id: project.authority.repositoryNodeId,
      full_name: new URL(repository.githubUrl).pathname.slice(1),
      private: false,
      owner: {
        id: Number(project.steward.github.actorId),
        node_id: project.steward.github.nodeId,
        login: project.steward.github.login,
        type: project.steward.github.type,
      },
    };
    await writeFile(
      entry,
      `
import {handleProjectApi} from ${JSON.stringify(resolve("backend/projects/handler.ts"))};
import {CloudflareProjectPersistence} from ${JSON.stringify(resolve("backend/projects/cloudflare-persistence.ts"))};
${options.incompleteAssessments ? `import {handleNotificationsApi} from ${JSON.stringify(resolve("backend/notifications/handler.ts"))};` : ""}
export default {async fetch(request,env) {
 ${
   options.incompleteAssessments
     ? `
 const role=request.headers.get('x-fixture-role');
 const viewer=role==='admin'?{githubId:'4243',githubLogin:'fixture-admin'}:role==='other'?{githubId:'4244',githubLogin:'fixture-other'}:${JSON.stringify(actor)};
 const notifications=await handleNotificationsApi(request,{
  db:env.DB,sessionActor:async()=>viewer,now:()=>new Date('2026-10-30T00:00:00.000Z'),adminGithubIds:new Set(['4243']),
  repositoryAccess:async()=>{if(request.headers.has('x-fixture-outage'))throw Error('Fixture unavailable');return {installation:'installed',installationId:42,permission:role==='other'?'read':'write',roleName:'maintain',repository:${JSON.stringify(facts)}};}
 });
 if(notifications)return notifications;`
     : ""
}
 const response=await handleProjectApi(request,{
  persistence:new CloudflareProjectPersistence(env.DB),adminGithubIds:new Set(),moderatorGithubIds:new Set(),
  sessionActor:async()=>(${options.incompleteAssessments ? "viewer" : JSON.stringify(actor)}),now:()=>new Date('2026-10-29T00:00:00.000Z'),
  randomId:()=>crypto.randomUUID(),github:{fetch:async()=>{throw new Error('No live GitHub read allowed')}},
  repositoryAccess:async()=>({installation:'installed',installationId:42,permission:'admin',roleName:'admin',repository:${JSON.stringify(facts)}}),
  repositoryControl:async()=>({state:'matched'}),vettingClearance:async()=>({state:'cleared',assessment:null,grandfathered:true}),
 });
 return response ?? new Response(null,{status:404});
}};`,
    );
    const build = spawnSync(
      "bun",
      [
        "--no-env-file",
        "build",
        entry,
        "--target=browser",
        "--outfile",
        output,
      ],
      { encoding: "utf8", env: childEnvironment(), timeout: 30_000 },
    );
    assert.equal(build.status, 0, build.stderr);
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        host: "127.0.0.1",
        port: 0,
        modules: true,
        compatibilityDate: "2026-09-14",
        script: await readFile(output, "utf8"),
        d1Databases: { DB: "project-image" },
        outboundService() {
          throw new Error("No external request allowed");
        },
      }),
    );
    const db = await runtime.getD1Database("DB");
    for (const name of (await readdir("migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort())
      await db.batch(
        splitSqlQuery(await readFile(`migrations/${name}`, "utf8")).map((sql) =>
          db.prepare(sql),
        ),
      );
    const text = JSON.stringify(project);
    const hash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(text),
    );
    const digest = Buffer.from(hash).toString("hex");
    const when = "2026-10-29T00:00:00.000Z";
    await db.batch([
      db
        .prepare(
          "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at,actor_github_id,actor_github_login) VALUES(?,1,?,?,'Image fixture',?,?,?)",
        )
        .bind(
          project.id,
          text,
          digest,
          when,
          actor.githubId,
          actor.githubLogin,
        ),
      db
        .prepare(
          "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,?,1,?,?,?,?)",
        )
        .bind(project.id, project.status, text, digest, when, when),
      ...(options.incompleteAssessments
        ? [
            db
              .prepare(
                "INSERT INTO project_repositories(repository_key,project_id) VALUES(?,?)",
              )
              .bind(repository.id.toLowerCase(), project.id),
          ]
        : []),
    ]);
    return {
      ...(options.incompleteAssessments ? { db } : {}),
      fetch: async (request) =>
        runtime.dispatchFetch(request.url, {
          method: request.method,
          headers: Object.fromEntries(request.headers),
          ...(request.method === "GET"
            ? {}
            : { body: await request.arrayBuffer() }),
        }),
      async stored() {
        const row = await db
          .prepare("SELECT revision,manifest FROM projects WHERE id=?")
          .bind(project.id)
          .first();
        return { revision: row.revision, project: JSON.parse(row.manifest) };
      },
      async dispose() {
        await runtime.dispose();
        await rm(folder, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await runtime?.dispose();
    await rm(folder, { recursive: true, force: true });
    throw error;
  }
}
