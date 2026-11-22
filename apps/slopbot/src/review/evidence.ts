// spec/slopbot/closure.md, "The evidence finding names a field that the declared change types of a signed Slop submission require"
import { type ChangeType, type EvidenceField, commonEvidence, evidenceFinding, requiredEvidence, validChangeTypes } from "../../gen/slopbot__closure.ts";

export const participationFooter = "Made via @slopdotcash";
export const evidenceHeading = "## Evidence";

export interface PolicyText {
  readonly path: string;
  readonly text: string;
  readonly truncated: boolean;
}

export interface MissingEvidence {
  readonly source: string;
  readonly quote: string;
  readonly fields: string[];
}

const changeTypesLabel = "Change types";

const fieldLabels: Readonly<Record<EvidenceField, string>> = {
  TestResults: "Test results",
  ProofOfChange: "Proof of change",
  RuntimeLogs: "Runtime logs",
  UiVideo: "UI video",
  UiScreenshots: "UI screenshots",
  Benchmarks: "Benchmarks",
  OnDeviceTesting: "On-device testing",
};

const allFields = Object.keys(fieldLabels) as EvidenceField[];

const changeTypes: ReadonlyMap<string, ChangeType> = new Map([
  ["docs", "Docs"],
  ["non-ui", "NonUi"],
  ["ui", "Ui"],
  ["performance", "Performance"],
  ["hardware", "Hardware"],
]);

const guideLabels = [changeTypesLabel, ...allFields.filter((field) => field !== "UiScreenshots").map((field) => fieldLabels[field])].map((label) => `${label}:`);

function visibleLines(markdown: string): string[] {
  let fence: string | undefined;
  return markdown
    .replace(/<!--[\s\S]*?(?:-->|$)/gu, "")
    .split(/\r?\n/u)
    .map((rawLine) => {
      const line = rawLine.trimEnd();
      const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
      if (fence !== undefined) {
        const closing = delimiter?.[1];
        if (closing?.startsWith(fence) && delimiter?.[2]?.trim() === "") fence = undefined;
        return "";
      }
      if (delimiter?.[1]) {
        fence = delimiter[1];
        return "";
      }
      return line;
    });
}

function evidenceSection(lines: string[]): string[] {
  const start = lines.indexOf(evidenceHeading);
  if (start === -1) return [];
  const end = lines.findIndex((line, index) => index > start && (/^#{1,2}\s/u.test(line) || line === participationFooter));
  return lines.slice(start + 1, end === -1 ? undefined : end);
}

function evidenceValue(section: string[], label: string): string | undefined {
  const prefix = `${label}:`;
  const values = section
    .map((line) => line.trimEnd().replace(/^ {0,3}(?:[-*+] )?/u, ""))
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim());
  return values.length === 1 ? values[0] : undefined;
}

function checkableLink(reference: string): boolean {
  const url = URL.parse(reference);
  return url !== null && url.pathname.length > 1 && url.username === "" && url.password === "" && url.hostname.includes(".") && !/^(?:www\.)?example\.(?:com|net|org)$/iu.test(url.hostname);
}

function hasEvidence(field: EvidenceField, value: string | undefined): boolean {
  if (!value || /^(?:n\/?a\b|not (?:applicable|run|tested)\b|none\b|tbd\b|todo\b|pending\b)/iu.test(value)) return false;
  const linked = (value.match(/https:\/\/[^\s<>()[\]]+/giu) ?? []).some(checkableLink);
  if (field === "UiVideo" || field === "UiScreenshots") return linked;
  return linked || (value.match(/[\p{L}\p{N}][\p{L}\p{N}_./-]*/gu)?.length ?? 0) >= 5;
}

function publishedGuide(policy: readonly PolicyText[]): PolicyText | undefined {
  return policy.find(({ path, text, truncated }) =>
    !truncated && /(?:^|\/)contributing\.md$/iu.test(path) && visibleLines(text).includes(evidenceHeading) && guideLabels.every((label) => text.includes(label)));
}

function guideListsScreenshots(guide: PolicyText): boolean {
  return evidenceSection(visibleLines(guide.text)).some((line) => /^ {0,3}(?:[-*+] )?(?:`UI screenshots:`|UI screenshots:)(?:\s|$)/u.test(line));
}

function ordered(fields: EvidenceField[]): EvidenceField[] {
  return fields.filter((field, index) => fields.indexOf(field) === index);
}

export function hasSlopParticipationFooter(body: string): boolean {
  return visibleLines(body).includes(participationFooter);
}

export function missingSubmissionEvidence(body: string, policy: readonly PolicyText[]): MissingEvidence | null {
  const guide = publishedGuide(policy);
  if (guide === undefined) return null;
  const lines = visibleLines(body);
  const footer = lines.includes(participationFooter);
  const section = evidenceSection(lines);
  const declared = evidenceValue(section, changeTypesLabel)?.replace(/\.$/u, "").split(",").map((type) => type.trim()) ?? [];
  const types = declared.flatMap((type) => {
    const known = changeTypes.get(type);
    return known === undefined ? [] : [known];
  });
  const typesMalformed = declared.length === 0 || types.length !== declared.length;
  const screenshots = types.includes("Ui") && guideListsScreenshots(guide);
  const supplied = allFields.filter((field) => hasEvidence(field, evidenceValue(section, fieldLabels[field])));
  if (!evidenceFinding(true, footer, typesMalformed, types, supplied, screenshots)) return null;
  const required = requiredEvidence(types, screenshots);
  const fields = ordered([...commonEvidence, ...types.flatMap((type) => requiredEvidence([type], false)), ...required])
    .filter((field) => required.includes(field) && !supplied.includes(field))
    .map((field) => fieldLabels[field]);
  return { source: guide.path, quote: evidenceHeading, fields: validChangeTypes(types, typesMalformed) ? fields : [changeTypesLabel, ...fields] };
}
