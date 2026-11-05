/**
 * Add-a-project text fields (PRD section 4, self-service setup): the setup
 * form measures name, headline and goal after trimming, so the manifest it
 * submits must carry that same trimmed text. The registry schema measures
 * the stored text as-is; a padded value the form accepted was rejected at
 * creation ("project.name is invalid") or stored with its padding, while the
 * Manage editor trims the same fields before submitting a revision.
 */
import { expect, test } from "bun:test";
import {
  boundedText,
  submittedProposalText,
} from "../src/lib/project-proposal";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import { findProject } from "../src/lib/projects.mjs";

const base = findProject("asi");
if (!base) throw new Error("fixture project missing");

const FIELDS = [
  { field: "name", min: 2, max: 80, padding: " " },
  { field: "headline", min: 8, max: 120, padding: "\n" },
  { field: "description", min: 24, max: 600, padding: " " },
] as const;

for (const { field, min, max, padding } of FIELDS) {
  test(`a ${field} at the form's limit with pasted padding is stored trimmed`, () => {
    const typed = `${"x".repeat(max)}${padding}`;
    // The setup form accepts the value: its limit counts the trimmed text.
    expect(boundedText(typed, min, max)).toBe(true);
    // The registry schema counts the stored text as-is, so submitting the
    // typed text unchanged fails creation with an invalid-manifest error.
    expect(() => assertProjectDefinition({ ...base, [field]: typed })).toThrow(
      `${field} is invalid`,
    );
    // The submitted text is the trimmed text the form validated, and the
    // stored manifest carries exactly that text.
    const stored = assertProjectDefinition({
      ...base,
      [field]: submittedProposalText(typed),
    }) as unknown as Record<string, unknown>;
    expect(stored[field]).toBe("x".repeat(max));
  });
}

test("padding inside the schema limit is not stored verbatim", () => {
  const stored = assertProjectDefinition({
    ...base,
    name: submittedProposalText("  Padded Project  "),
  }) as unknown as Record<string, unknown>;
  expect(stored.name).toBe("Padded Project");
});
