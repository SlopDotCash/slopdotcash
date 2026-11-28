// spec/points/assessmentAudit.md, "Story: Audit the assessments of a historical scope before owner review"
import { Effect } from "effect";
import type { Driver } from "../../gen/points__assessmentAudit.conformance.ts";
import type { AssessmentAudit } from "../../gen/points__assessmentAudit.ts";
import { advanceAudit, initialAuditState, receiveAudit } from "../../src/corrections/reviewed/audit/cut.vibe";

const states = new Map<string, AssessmentAudit>();
const observe = (key: string) => states.get(key) ?? initialAuditState;
const refused = () => Effect.succeed("refused" as const);

function record(key: string, next: ReturnType<typeof receiveAudit>) {
  return Effect.runPromise(next.pipe(
    Effect.map((state) => {
      states.set(key, state);
      return "accepted" as const;
    }),
    Effect.catchTags({ Rejected: refused, NotAnEvent: refused }),
  ));
}

export const driver: Driver = {
  reset: () => states.clear(),
  dispatch: (key, event, by) => record(key, advanceAudit(observe(key), event, by)),
  receive: (key, input, by) => record(key, receiveAudit(observe(key), input, by)),
  observe,
};
