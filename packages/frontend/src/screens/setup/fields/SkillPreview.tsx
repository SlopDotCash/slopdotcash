// spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"
import { Alert, Button, CodeBlock, Disclosure, SegmentedControl } from "@repo/ui";
import { FileText } from "lucide-react";
import { useState } from "react";
import { SelectField } from "./ProjectFields.tsx";
import { type RegistryBinding, type SkillRole, skillPreviews } from "./skillFiles.ts";

export type SkillProvenance = { readonly status: "preparing" } | { readonly status: "failed" } | { readonly status: "ready"; readonly registry: RegistryBinding };

export type SkillPreviewProps = {
  manifest: unknown;
  provenance: SkillProvenance;
  draft?: boolean;
  collapsible?: boolean;
  compact?: boolean;
};

const roleNames: Readonly<Record<SkillRole, string>> = { contributor: "Contributor", reviewer: "Reviewer" };

const roleOptions = [
  { value: "contributor", label: roleNames.contributor },
  { value: "reviewer", label: roleNames.reviewer },
];

const isRole = (value: string): value is SkillRole => value === "contributor" || value === "reviewer";

/** The exact contributor and reviewer skills a project revision publishes, rendered by the contributor renderer. */
export function SkillPreview({ manifest, provenance, draft = false, collapsible = true, compact = false }: SkillPreviewProps) {
  const [role, setRole] = useState<SkillRole>("contributor");
  const [chosenPath, setChosenPath] = useState("SKILL.md");
  const [open, setOpen] = useState(false);
  if (provenance.status === "preparing") return <p role="status">Preparing skill preview…</p>;
  if (provenance.status === "failed") return <Alert variant="destructive">Could not prepare the skill preview. Reload and try again.</Alert>;
  const previews = skillPreviews(manifest, provenance.registry);
  if (previews.kind === "committed") return <p className="text-sm text-muted-foreground">This project uses committed skills at {previews.sourcePath}.</p>;
  if (previews.kind === "refused") return <Alert variant="destructive">Could not render skills.</Alert>;
  const files = previews.roles[role];
  const path = !files.some((file) => file.path === chosenPath) ? "SKILL.md" : chosenPath;
  const shown = files.find((file) => file.path === path);
  const content = (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <SegmentedControl aria-label="Skill" options={roleOptions} value={role} onValueChange={(value) => isRole(value) && setRole(value)} />
        <SelectField label="File" name="skill-file" value={path} options={files.map((file) => [file.path, file.path] as const)} onChange={setChosenPath} />
        {draft ? <span className="text-sm text-muted-foreground">Draft preview</span> : null}
      </div>
      <CodeBlock label={`${roleNames[role]} skill ${path}`} code={shown?.text ?? ""} />
      <p className="font-mono text-xs break-all text-muted-foreground">
        Revision {provenance.registry.revision} · SHA-256 {provenance.registry.manifestSha256}
      </p>
    </div>
  );
  if (compact)
    return (
      <section aria-label="Generated skills" className="flex flex-col gap-4">
        <Button variant="outline" className="self-start" aria-expanded={open} onClick={() => setOpen(!open)}>
          <FileText aria-hidden className="size-4" /> Preview skill
        </Button>
        {open ? (
          <>
            <SegmentedControl aria-label="Skill" options={roleOptions} value={role} onValueChange={(value) => isRole(value) && setRole(value)} />
            <CodeBlock label={`${roleNames[role]} SKILL.md`} code={shown?.text ?? ""} />
          </>
        ) : null}
      </section>
    );
  return collapsible ? <Disclosure summary="Preview generated skills">{content}</Disclosure> : <section aria-label="Generated skills">{content}</section>;
}
