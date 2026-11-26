import { Layer, ManagedRuntime } from "effect";
import { fn } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { PageRuntime } from "../../app/runtime.vibe";
import type { AdmissionExemptionsProps } from "./AdmissionExemptions.tsx";
import { exemption } from "./fixtures.ts";

const runtime = ManagedRuntime.make(Layer.empty) as unknown as PageRuntime;

export const meta: ComponentMeta<AdmissionExemptionsProps> = {
  args: {
    runtime,
    actorId: "1",
    project: {
      id: "engine",
      name: "Engine",
      status: "active",
      revision: 3,
      repositories: [{ id: "octo-org/engine", githubId: "4242" }],
      clearance: null,
    },
    exemptions: [exemption],
    onAccessLost: fn(),
    onSaved: fn(),
  },
  examples: {
    Grant: { exemptions: [] },
  },
};
