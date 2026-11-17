// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
import { cn, focusRing, target } from "@repo/ui";
import { setupSteps, type StepIndex } from "./form.ts";

export type SetupStepsProps = {
  current: StepIndex;
  onChoose: (step: StepIndex) => void;
};

const indexes = [0, 1, 2] as const satisfies ReadonlyArray<StepIndex>;

/** Project, Rewards and Review, the one in progress marked; each opens its step. */
export function SetupSteps({ current, onChoose }: SetupStepsProps) {
  return (
    <nav aria-label="Setup steps">
      <ol className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {indexes.map((index) => (
          <li key={setupSteps[index]}>
            <button
              type="button"
              aria-current={index === current ? "step" : undefined}
              onClick={() => onChoose(index)}
              className={cn(focusRing, target, "flex items-center gap-2 rounded-sm", index === current ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              <span aria-hidden className={cn("flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs tabular-nums", index === current ? "border-primary bg-primary text-primary-foreground" : "border-input")}>
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
