// spec/fees/submissionFeeReportDeposits.md, "The security area writes and decides the row; the Worker pays it and follows the chain"
import type { Options } from "../../gen/fees__submissionFeeReportDeposits.conformance.ts";
import type { Party } from "../../gen/fees__submissionFeeDeposits.ts";
import type { Event, ReportDeposit } from "../../gen/fees__submissionFeeReportDeposits.ts";
import { reportDepositModel } from "../../src/submissionFee/store.vibe";
import { machineDriver } from "../support/machine.ts";

export const driver = await machineDriver<Event, ReportDeposit, Party>(() => reportDepositModel(), { known: ["Chain", "Slopbot", "Security", "Worker"], otherwise: "Chain" });

export const options: Options = { keys: ["report"], walks: 10, steps: 16 };
