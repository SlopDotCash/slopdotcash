import {
  type PagesEnv,
  type PagesMiddlewareContext,
  vettingContext,
} from "../backend/pages";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import { githubApiOrigin } from "../backend/projects/github-lookup";
import { readIntakeCounts } from "../backend/projects/merge-activity";
import { readPoolFundingIndex } from "../backend/projects/pool-funding";
import { handleProjectArtifactRequest } from "../backend/projects/skill-publication";
import { referralRedirect } from "../backend/referrals/codes";
import { deploymentTier } from "../src/lib/deployment";
import { onRequest as socialMetadata } from "./index";

export async function onRequest(
  context: PagesMiddlewareContext<Partial<PagesEnv>>,
): Promise<Response> {
  const { request, env } = context;
  if (env.SLOP_DB !== undefined) {
    const referral = await referralRedirect(request, env.SLOP_DB, {
      fetch: (url, init) => fetch(url, init),
      token: env.SLOP_GITHUB_READ_TOKEN,
      apiOrigin: githubApiOrigin(env.SLOP_GITHUB_API_ORIGIN),
    });
    if (referral !== null) return referral;
    const persistence = new CloudflareProjectPersistence(env.SLOP_DB);
    const { vetting, loadTemplate, livePin } = vettingContext(
      { ...env, SLOP_DB: env.SLOP_DB },
      request,
    );
    const db = env.SLOP_DB;
    const artifact = await handleProjectArtifactRequest(request, {
      getProject: (id) => persistence.getProject(id),
      listProjects: () => persistence.listProjects(),
      listEnforcements: () => persistence.listEnforcements(),
      loadTemplate,
      vettingClearance: (project, templateSha256) =>
        vetting.manifestClearance(
          project.id,
          project.manifest,
          project.revision,
          (repositoryId) =>
            livePin(project.manifest, repositoryId, templateSha256),
        ),
      poolFunding: () =>
        readPoolFundingIndex(
          db,
          deploymentTier(env.SLOP_ENVIRONMENT),
          new Date(),
        ),
      intakeCounts: () => readIntakeCounts(db),
    });
    if (artifact !== null) return artifact;
  }
  return socialMetadata(context);
}
