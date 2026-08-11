/**
 * Fails CI unless every checked-in evaluated-contribution award is bounded,
 * canonical, unique, and tied to a public Army review decision.
 */

import { loadEvaluatorAwardEvents } from "../src/lib/evaluator-awards";

export function validateEvaluatorAwards(): number {
  return loadEvaluatorAwardEvents().length;
}

if (import.meta.main) {
  const count = validateEvaluatorAwards();
  process.stdout.write(
    `[Slop] validated ${count} evaluated contribution award${count === 1 ? "" : "s"}\n`,
  );
}
