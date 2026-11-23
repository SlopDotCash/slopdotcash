// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
import { cn, focusRing } from "@repo/ui";
import { setupSteps, type StepIndex } from "./form.ts";

export type SetupStepsProps = {
  current: StepIndex;
  onChoose: (step: StepIndex) => void;
};

const indexes = [0, 1, 2] as const satisfies ReadonlyArray<StepIndex>;

/** Project, Rewards and Review, the one in progress marked; each opens its step. */
export function SetupSteps({ current, onChoose }: SetupStepsProps) {
  return (
    <nav aria-label="Setup steps" className="mb-6">
      <ol className="grid grid-cols-3 border-b border-border">
        {indexes.map((index) => (
          <li key={setupSteps[index]} className="flex min-h-17 items-center">
            <button
              type="button"
              aria-current={index === current ? "step" : undefined}
              onClick={() => onChoose(index)}
              className={cn(focusRing, "flex min-h-13 w-full items-center gap-2 border-b-2 px-2.5 py-2 text-left text-ui font-strong max-md:flex-col max-md:justify-center max-md:gap-1 max-md:text-center", index === current ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              <span aria-hidden className={cn("grid size-6.5 shrink-0 place-items-center rounded-full border text-xs tabular-nums", index === current ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
                {index + 1}
              </span>
              {setupSteps[index]}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
