// spec/fees/submissionFeeDeposits.md, "A deposit is recorded once confirmed and final once finalized, and a reorganised one stops paying"
import type { Options } from "../../gen/fees__submissionFeeDeposits.conformance.ts";
import type { Event, FeeDeposit, Party } from "../../gen/fees__submissionFeeDeposits.ts";
import { depositModel } from "../../src/submissionFee/store.vibe";
import { machineDriver } from "../support/machine.ts";

export const driver = await machineDriver<Event, FeeDeposit, Party>(() => depositModel(), { known: ["Chain", "Slopbot", "Security", "Worker"], otherwise: "Chain" });

export const options: Options = { keys: ["deposit"], walks: 10, steps: 16 };
