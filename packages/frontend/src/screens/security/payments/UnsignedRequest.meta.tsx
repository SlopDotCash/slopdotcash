import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { ownerRequest } from "./fixtures.ts";
import type { UnsignedRequestProps } from "./UnsignedRequest.tsx";

export const meta: ComponentMeta<UnsignedRequestProps> = {
  args: { request: ownerRequest, raw: ownerRequest },
  play: {
    // spec/settlement/directBounty.md, "A standard award freezes its network, asset and two split amounts"
    Default: async () => {
      await expect(screen.getByRole("group", { name: "Researcher amount" })).toHaveTextContent("7,500");
      await expect(screen.getByRole("group", { name: "Slop fee amount" })).toHaveTextContent("2,500");
      await expect(screen.getByRole("group", { name: "Researcher wallet" })).toHaveTextContent(ownerRequest.transfers[0]?.recipient ?? "");
    },
  },
};
