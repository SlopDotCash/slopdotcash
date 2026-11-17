import type { ComponentMeta } from "vibestack/stories";
import type { NetworkMarkProps } from "./NetworkMark.tsx";

// Each network once; a hidden name stays the accessible name.
export const meta: ComponentMeta<NetworkMarkProps> = {
  args: { network: "Base" },
  examples: {
    Ethereum: { network: "Ethereum" },
    "Robinhood Chain": { network: "Robinhood Chain" },
    Solana: { network: "Solana" },
    "Mark only": { network: "Solana", showName: false, size: "lg" },
  },
};
