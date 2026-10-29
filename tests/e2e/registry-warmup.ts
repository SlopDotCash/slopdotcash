/**
 * Registry lane global setup. Playwright runs it after the local Pages
 * server is ready and before the first test.
 *
 * On Windows, the local Pages server's SLOP_NOTIFY service binding to the
 * separate `wrangler dev` notify Worker fails with "Network connection lost"
 * for some seconds after the server starts (3 to 19 s in local runs). The
 * first registry test is the Firefox email preference workflow, so it showed
 * "We could not check your email address". This read-only request waits, with
 * a bound, until the binding answers. It changes no data.
 */
import type { FullConfig } from "@playwright/test";

const DEADLINE_MS = 60_000;

export default async function warmRegistryServiceBindings(
  config: FullConfig,
): Promise<void> {
  const origin = config.projects[0]?.use.baseURL;
  const token = process.env.SLOP_E2E_APPLICANT_TOKEN;
  if (!origin || !token) return;
  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/v1/notifications/email`, {
        headers: { cookie: `__Host-slop_points=${token}` },
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await response.json()) as { availability?: unknown };
      // "unavailable" means the notify Worker did not answer.
      if (response.ok && body.availability !== "unavailable") return;
    } catch {
      // Retry below. A binding that never answers fails the tests that use it.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
