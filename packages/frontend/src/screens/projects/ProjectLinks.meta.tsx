import { expect, screen } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { ProjectLinksProps } from "./ProjectLinks.tsx";

const usdcBase = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const token = "0x1111111111111111111111111111111111111111";

export const meta: ComponentMeta<ProjectLinksProps> = {
  args: {
    record: {
      links: { repository: "https://github.com/ntwrk/party", website: "https://www.ntwrk.party/", x: "https://x.com/slopcash" },
      escrow: { deployments: [{ network: "base-mainnet", asset: usdcBase }] },
    },
  },
  examples: {
    Networks: {
      record: {
        links: { repository: "https://github.com/ntwrk/party" },
        rewardAsset: { network: "robinhood", address: token, symbol: "TOON" },
        escrow: { deployments: [{ network: "robinhood-mainnet", asset: token }, { network: "solana-mainnet", asset: "So11111111111111111111111111111111111111112" }] },
      },
    },
    WebsiteOnly: { record: { links: { repository: "https://github.com/ntwrk/party", website: "https://ntwrk.party/docs?tab=start" } } },
    Nothing: { record: { links: { repository: "https://github.com/ntwrk/party", x: "https://example.org/slopcash" } } },
  },
  play: {
    // spec/frontend/projectLinks.md, "The project page names each vault network once, with its asset only when every vault on it agrees, and shows the website and X account only when present"
    Default: async () => {
      await expect([screen.getByText(/^Chain: Base \(USDC\)/u).textContent, screen.getByRole("link", { name: "ntwrk.party" }).getAttribute("href"), screen.getByRole("link", { name: "@slopcash" }).getAttribute("target")]).toEqual([
        "Chain: Base (USDC) · Website: ntwrk.party · X: @slopcash",
        "https://www.ntwrk.party/",
        "_blank",
      ]);
    },
    // spec/frontend/projectLinks.md, "The project page names each vault network once, with its asset only when every vault on it agrees, and shows the website and X account only when present"
    Networks: async () => {
      await expect([screen.getByText(/^Chain:/u).textContent, screen.queryByRole("link")]).toEqual(["Chain: Robinhood Chain (TOON), Solana", null]);
    },
    // spec/frontend/projectLinks.md, "The project page names each vault network once, with its asset only when every vault on it agrees, and shows the website and X account only when present"
    WebsiteOnly: async () => {
      await expect(screen.getByText(/^Website:/u).textContent).toBe("Website: ntwrk.party/docs?tab=start");
    },
    // spec/frontend/projectLinks.md, "The project page names each vault network once, with its asset only when every vault on it agrees, and shows the website and X account only when present"
    Nothing: async () => {
      await expect([screen.queryByText(/Chain:|Website:|X:/u), screen.queryByRole("link")]).toEqual([null, null]);
    },
  },
};
