import { expect, fn, screen, userEvent } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { initial, type Settings } from "../../gen/frontend__referralSettings.ts";
import { referralMessages } from "../flows/account/referral.vibe";
import type { ReferralSettingsProps } from "./ReferralSettings.tsx";

const onEdit = fn();
const onSave = fn();
const unnamed: Settings = { ...initial, actor: "583231", lifetime: 1 };
const named: Settings = { ...unnamed, savedCode: "DrewBuilds", draft: "DrewBuilds" };

export const meta: ComponentMeta<ReferralSettingsProps> = {
  args: { settings: named, origin: "https://slop.cash", onEdit, onSave, onCopy: () => Promise.resolve() },
  examples: {
    Unnamed: { settings: unnamed },
    Saving: { settings: { ...named, draft: "Bravo-2", sequence: 1, pending: 1, notice: "Saving" } },
    Saved: { settings: { ...named, sequence: 1, notice: "Saved" } },
    InvalidDraft: { settings: { ...unnamed, draft: "ab", notice: "InvalidDraft" }, problem: referralMessages.rule },
    SaveFailed: { settings: { ...named, draft: "taken-name", sequence: 1, notice: "SaveFailed" }, problem: "That name is taken. Choose another." },
  },
  play: {
    // spec/frontend/referralSettings.md, "Exactly one request can act for each active account lifetime"
    Default: async () => {
      onSave.mockClear();
      const save = screen.getByRole("button", { name: "Save" });
      await expect(save).toBeDisabled();
      const name = screen.getByRole("textbox", { name: "Link name" });
      await userEvent.clear(name);
      await userEvent.type(name, "Bravo-2{Enter}");
      await expect(onSave).toHaveBeenCalledWith("Bravo-2");
    },
    // spec/frontend/referralSettings.md, "A loaded account owns the displayed link and the editable draft"
    Unnamed: async () => {
      await expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
    },
  },
};
