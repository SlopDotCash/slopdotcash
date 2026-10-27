/** Native integration fixture: production handler/service code, synthetic owner authority. */
import { handlePaymentsApi } from "../backend/payments/handler";
import {
  MonthlyPaymentError,
  monthlyOwnerService,
} from "../backend/payments/monthly";
import {
  CloudflareProjectPersistence,
  type ProjectD1Database,
} from "../backend/projects/cloudflare-persistence";
import { parseMonthlySchedule } from "../src/lib/payments/monthly-allocation";
import { parsePaymentNetworks } from "../workers/payments/deployments";

interface Environment {
  SLOP_DB: ProjectD1Database;
  PAYMENT_NETWORKS: string;
  MONTHLY_PAYMENT_SCHEDULE: string;
  TEST_RELEASE_BINDING: string;
  [key: string]: unknown;
}

export default {
  async fetch(request: Request, env: Environment) {
    const projects = new CloudflareProjectPersistence(env.SLOP_DB);
    const response = await handlePaymentsApi(request, {
      tier: "staging",
      db: env.SLOP_DB,
      now: () => new Date("2026-12-04T00:01:00.000Z"),
      monthly: monthlyOwnerService({
        db: env.SLOP_DB,
        getProject: (id) => projects.getProject(id),
        restricted: async () => false,
        networks: () => parsePaymentNetworks(env.PAYMENT_NETWORKS),
        schedule: () => parseMonthlySchedule(env.MONTHLY_PAYMENT_SCHEDULE),
        now: () => new Date("2026-12-04T00:01:00.000Z"),
        // The test supplies the independently authenticated owner identity;
        // external GitHub authority qualification is not claimed by this fixture.
        verifyAuthority: async (_project, actor) => {
          if (actor.githubId !== "18633264")
            throw new MonthlyPaymentError(
              403,
              "not_owner",
              "Test owner required",
            );
        },
        releaseReserve: async (input) => {
          const service = env[env.TEST_RELEASE_BINDING] as
            | { fetch(request: Request): Promise<Response> }
            | undefined;
          if (!service)
            throw new MonthlyPaymentError(
              503,
              "release_unavailable",
              "Test service missing",
            );
          const response = await service.fetch(
            new Request("https://monthly-release/v1/monthly-reserve-release", {
              method: "POST",
              body: JSON.stringify(input),
            }),
          );
          if (!response.ok)
            throw new MonthlyPaymentError(
              409,
              "release_held",
              "Test release refused",
            );
          return response.json();
        },
      }),
    });
    response.headers.set(
      "x-fixture-transport-origin",
      new URL(request.url).origin,
    );
    return response;
  },
};
