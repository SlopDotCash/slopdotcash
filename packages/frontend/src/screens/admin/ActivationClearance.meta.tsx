import { Layer, ManagedRuntime } from "effect";
import { fn } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { PageRuntime } from "../../app/runtime.vibe";
import type { ActivationClearanceProps } from "./ActivationClearance.tsx";

const runtime = ManagedRuntime.make(Layer.empty) as unknown as PageRuntime;

export const meta: ComponentMeta<ActivationClearanceProps> = {
  args: {
    runtime,
    actorId: "1",
    projectId: "engine",
    revision: 3,
    onAccessLost: fn(),
  },
};
