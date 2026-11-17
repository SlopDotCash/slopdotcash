// spec/slopbot/closeCapacity.md, "A reservation, its confirmation and its rejection are each recorded once, on GitHub's evidence"; spec/points/penalties.md, "A confirmed close records the published debit once per PR, never after a confirmed reopen of that revision"

export const closeAttemptWrites = ["slopbot_close_attempts", "slopbot_penalties"] as const;
