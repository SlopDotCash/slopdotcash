// spec/fees/directBountyIncome.md, "Story: Distinguish funds received from income booked for a completed direct award"
import type { Options } from "../../gen/fees__directBountyIncome.conformance.ts";
import type { Event, FeeJournal, Reader } from "../../gen/fees__directBountyIncome.ts";
import { feeJournal } from "../../src/directIncome/store.vibe";
import { machineDriver } from "../support/machine.ts";

export const driver = await machineDriver<Event, FeeJournal, Reader>(() => feeJournal(), { known: ["SettlementJournal", "OtherReader"], otherwise: "OtherReader" });

export const options: Options = { keys: ["journal"], walks: 10, steps: 12 };
