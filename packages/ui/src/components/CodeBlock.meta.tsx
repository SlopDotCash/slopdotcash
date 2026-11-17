import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { CodeBlockProps } from "./CodeBlock.tsx";

type Context = { args: CodeBlockProps; canvasElement: HTMLElement };

const change = JSON.stringify({ monthlyPool: { before: "5000.00 USDC", after: "7500.00 USDC" }, reviewers: ["octocat", "hubot"], exemptPaths: ["docs/**", "examples/**/fixtures/*.json"] }, null, 2);
const report = [
  "Affected component and revision: packages/vault/src/withdraw.ts at 4f9c2e1",
  "",
  "Impact: a withdrawal signed for one vault can be replayed against a second vault that shares the owner key, because the signed message omits the vault address.",
  "",
  "Safe reproduction steps:",
  "1. Deploy two vaults with the same owner on a local chain.",
  "2. Sign a withdrawal for the first vault and submit it to the second.",
].join("\n");

export const meta: ComponentMeta<CodeBlockProps> = {
  args: { code: change, label: "Proposed change" },
  examples: {
    Report: { code: report, label: "Report", kind: "prose" },
    Unlabelled: { code: change, label: undefined, "aria-label": "Recorded value" },
  },
  play: {
    // spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"
    Default: async ({ args, canvasElement }: Context) => {
      const block = within(canvasElement).getByRole("group", { name: "Proposed change" });
      await userEvent.tab();
      await expect(document.activeElement).toBe(block);
      await expect(block.textContent).toBe(args.code);
    },
    // spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"
    Report: async ({ canvasElement }: Context) => {
      const block = within(canvasElement).getByRole("group", { name: "Report" });
      await userEvent.tab();
      await expect(document.activeElement).toBe(block);
      await expect(block.textContent).toBe(report);
    },
  },
};
