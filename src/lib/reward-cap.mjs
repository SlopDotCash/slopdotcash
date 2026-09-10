/** Resolve a reviewed manifest's exact UTC cycle override. No project identities
 * or dates are inferred; unlisted cycles retain the default cap policy. */
export function resolveRewardCapMinor(project, cycleId) {
  if (
    typeof cycleId !== "string" ||
    !/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(cycleId)
  )
    throw new TypeError("reward cap requires a valid UTC cycle month");
  return (
    project.reward.cycleCaps?.find((cap) => cap.cycleId === cycleId)
      ?.monthlyCapMinor ?? project.reward.monthlyCapMinor
  );
}
