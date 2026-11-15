import type { Announcement } from "../../gen/ui__status.ts";

// spec/ui/status.md, "Read states show loading, emptiness, staleness and failure differently"
/** The politeness of a live region that stays in the page while what it holds changes. */
export const politeness = { Assertive: "assertive", Polite: "polite", Silent: "off" } as const satisfies Record<Announcement, string>;

/** The role of a message that appears with what it says: an alert interrupts, a status waits its turn. */
export const announcer = { Assertive: "alert", Polite: "status", Silent: undefined } as const satisfies Record<Announcement, string | undefined>;
