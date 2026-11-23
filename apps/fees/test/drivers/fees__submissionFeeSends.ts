// spec/fees/submissionFeeSends.md, "A signed send is recorded before broadcast and one send per network is in flight"
import type { Options } from "../../gen/fees__submissionFeeSends.conformance.ts";
import type { Actor, Event, Sends } from "../../gen/fees__submissionFeeSends.ts";
import { sendsModel } from "../../src/submissionFee/sends.vibe";
import { machineDriver } from "../support/machine.ts";

export const driver = await machineDriver<Event, Sends, Actor>(() => sendsModel(), { known: ["Release", "Chain", "Worker"], otherwise: "Worker" });

export const options: Options = { keys: ["network"], walks: 10, steps: 16 };
