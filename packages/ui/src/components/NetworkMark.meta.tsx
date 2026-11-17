import { expect } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { NetworkMarkProps } from "./NetworkMark.tsx";

type Context = { canvasElement: HTMLElement };

export const meta: ComponentMeta<NetworkMarkProps> = {
  args: { network: "Base" },
  examples: {
    "Test network": { network: "Robinhood Chain Testnet" },
    "Mark only": { network: "Solana", showName: false },
    Decorative: { network: "Ethereum Sepolia", showName: false, decorative: true },
  },
  play: {
    // spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"
    Decorative: ({ canvasElement }: Context) => {
      const mark = canvasElement.querySelector("span");
      return expect([mark?.getAttribute("aria-hidden"), mark?.textContent]).toEqual(["true", ""]);
    },
  },
};
