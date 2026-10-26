import {
  type PagesEnv,
  type PagesMiddlewareContext,
  vettingContext,
} from "../backend/pages";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import { handleProjectArtifactRequest } from "../backend/projects/skill-publication";
import { onRequest as socialMetadata } from "./index";

export async function onRequest(
  context: PagesMiddlewareContext<Partial<PagesEnv>>,
): Promise<Response> {
  const { request, env } = context;
  if (env.SLOP_DB !== undefined) {
    const persistence = new CloudflareProjectPersistence(env.SLOP_DB);
    const { vetting, loadTemplate, livePin } = vettingContext(
      { ...env, SLOP_DB: env.SLOP_DB },
      request,
    );
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
          () => livePin(project.manifest, templateSha256),
        ),
    });
    if (artifact !== null) return artifact;
  }
  return socialMetadata(context);
}
