import { deploymentOrigins, deploymentTier } from "./deployment";
export const browserDeployment = deploymentOrigins(
  deploymentTier(import.meta.env.VITE_SLOP_ENVIRONMENT),
);
