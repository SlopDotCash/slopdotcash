import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { shown } from "../../gen/ui__status.ts";
import { Button } from "./Button.tsx";
import type { TransactionStatusProps } from "./TransactionStatus.tsx";

type Context = { canvasElement: HTMLElement };

const hash = "0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060";
const signature = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const check = fn();
const written = fn(() => Promise.resolve());

export const meta: ComponentMeta<TransactionStatusProps> = {
  args: { presentation: shown("Notice", "Spinner", "Pending"), hash, explorerUrl: `https://basescan.org/tx/${hash}`, explorerLabel: "View on Basescan" },
  examples: {
    "Not confirmed": { presentation: shown("Caution", "Alert", "Not confirmed"), actions: <Button variant="secondary" onClick={check}>Check transaction</Button> },
    "Not sent": { presentation: shown("Neutral", "Slash", "Not sent"), hash: undefined, explorerUrl: undefined },
    Finalized: { presentation: shown("Positive", "Check", "Finalized"), onCopy: written },
    Failed: { presentation: shown("Negative", "Ban", "Failed") },
    Solana: {
      presentation: shown("Notice", "Spinner", "Pending"),
      hash: signature,
      hashLabel: "Transaction signature",
      explorerUrl: `https://explorer.solana.com/tx/${signature}`,
      explorerLabel: "View on Solana Explorer",
    },
  },
  play: {
    // spec/ui/status.md, "A presentation is a tone, an icon and a word"
    Finalized: async ({ canvasElement }: Context) => {
      written.mockClear();
      const canvas = within(canvasElement);
      await expect(canvas.getByText("Finalized")).toBeVisible();
      await expect(canvas.getByRole("link", { name: "View on Basescan, opens in a new tab" }).getAttribute("href")).toBe(`https://basescan.org/tx/${hash}`);
      await userEvent.click(canvas.getByRole("button", { name: "Copy transaction hash" }));
      await waitFor(() => expect(written.mock.calls).toEqual([[hash]]));
    },
    // spec/ui/controls.md, "Story: Act only when an action is available"
    "Not confirmed": async ({ canvasElement }: Context) => {
      check.mockClear();
      const button = within(canvasElement).getByRole("button", { name: "Check transaction" });
      button.focus();
      await userEvent.keyboard("{Enter}");
      await expect(check).toHaveBeenCalledTimes(1);
    },
  },
};
