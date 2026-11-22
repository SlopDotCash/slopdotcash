import { expect, fn, screen, userEvent, waitFor } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { draft, proof } from "./fixtures.ts";
import type { ReportProofFieldsProps } from "./ReportProofFields.tsx";

const onDescription = fn();
const onProof = fn();

export const meta: ComponentMeta<ReportProofFieldsProps> = {
  args: { description: draft.description, proofName: "", proofText: "", disabled: false, onDescription, onProof },
  examples: {
    Chosen: { proofName: proof.fileName, proofText: proof.patch },
    TooLong: { description: "x".repeat(65000), proofName: proof.fileName, proofText: proof.patch },
    Sending: { proofName: proof.fileName, proofText: proof.patch, disabled: true },
  },
  play: {
    // spec/frontend/drafts.md, "Editing keeps storage failures visible and invalidates the reviewed content"
    Default: async () => {
      onProof.mockClear();
      const chosen = new File([proof.patch], proof.fileName, { type: "text/plain" });
      await userEvent.upload(screen.getByLabelText<HTMLInputElement>("Proof of concept"), chosen);
      await waitFor(() => expect(onProof).toHaveBeenCalledWith(proof.fileName, proof.patch));
      onProof.mockClear();
      await userEvent.upload(screen.getByLabelText<HTMLInputElement>("Proof of concept"), new File(["a\u0000b"], "binary.ts", { type: "text/plain" }));
      await expect(await screen.findByRole("alert")).toBeTruthy();
      await expect(onProof).not.toHaveBeenCalled();
    },
    // spec/frontend/drafts.md, "Editing keeps storage failures visible and invalidates the reviewed content"
    Chosen: async () => {
      onProof.mockClear();
      await userEvent.click(screen.getByRole("button", { name: "Remove" }));
      await expect(onProof).toHaveBeenCalledWith("", "");
    },
    // spec/security/intake.md, "A report body holds between 1 and 262,144 bytes and any other size creates nothing"
    TooLong: async () => {
      await expect(screen.getByRole("alert")).toBeTruthy();
    },
    // spec/frontend/drafts.md, "The first send fixes a key and retries keep that key and content"
    Sending: async () => {
      await expect(screen.getByRole("button", { name: "Remove" })).toHaveProperty("disabled", true);
    },
  },
};
