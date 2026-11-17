// spec/slopbot/workUnits.md, "A claim is one changed path in one commit and belongs to its first accepted carrier"
export { type MergeBundle, MAX_BUNDLE, createMergeBundle, createMergeBundleFromFile, unbundledStore } from "./bundle.vibe";
export { PINNED_GIT_SHA256, PINNED_GIT_SOURCE, installPinnedGit } from "./install.vibe";
export * from "./evidence.ts";
export { requiredMergeObjects, verifyMergeObjectStore } from "./objects.vibe";
export { Git, type GitCall, gitAt, gitBytes, systemGit } from "./process.vibe";
export { type PublicFile, type PublicMergeRepository, type VerifiedSource, publicFiles, publicGitArguments, verifiedRecipeResolutions, withPublicGitObjects } from "./public.vibe";
export { recoverFiles } from "./recovery.vibe";
export { collectMergeResolutions, collectVerifiedMergeResolutionBatch, collectVerifiedMergeResolutions } from "./resolution.vibe";
