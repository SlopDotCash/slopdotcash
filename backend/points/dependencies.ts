/** Dependencies of the points API, shared by its handler and the X connection flow. */
import type { DeploymentTier } from "../../src/lib/deployment";
import type { D1TransactionalDatabase as D1Database } from "../d1";
import type { PointsDisputeDependencies } from "./disputes";

export interface XConfiguration {
  clientId: string;
  clientSecret: string;
}

export interface PointsDependencies {
  tier?: DeploymentTier;
  db: D1Database;
  rateLimitSecret: string;
  identity: { fetch(request: Request): Promise<Response> };
  now?: () => Date;
  /** Trusted deployment origins; never request-supplied. */
  allowedOrigins?: readonly string[];
  x?: XConfiguration;
  xFetch?: (input: string, init: RequestInit) => Promise<Response>;
  disputes?: Pick<
    PointsDisputeDependencies,
    "moderators" | "process" | "waitUntil"
  >;
}
