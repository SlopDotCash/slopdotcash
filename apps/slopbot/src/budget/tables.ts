// spec/slopbot/budgetBlocks.md, "Only the current claim owner records an immutable block"; spec/slopbot/budgetBlocks.md, "A due block is sent once while its claim is still the failed current one"

export const budgetWrites = ["slopbot_budget_blocks", "slopbot_budget_dispatches"] as const;
