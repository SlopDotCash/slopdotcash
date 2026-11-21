const FOOTER = "Made via @slopdotcash";
const SECTION = "## Evidence";
const COMMON_FIELDS = ["Test results", "Proof of change"];
const CHANGE_FIELDS = new Map([
  ["docs", null],
  ["non-ui", "Runtime logs"],
  ["ui", "UI video"],
  ["performance", "Benchmarks"],
  ["hardware", "On-device testing"],
]);

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
        if (closing?.startsWith(fence) && delimiter?.[2]?.trim() === "")
          fence = undefined;
        return "";
      }
      if (delimiter?.[1]) {
        fence = delimiter[1];
        return "";
      }
      return line;
    });
}

function evidenceValue(section: string[], field: string): string | undefined {
  const prefix = `${field}:`;
  const values = section
    .map((line) => line.trimEnd().replace(/^ {0,3}(?:[-*+] )?/u, ""))
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim());
  return values.length === 1 ? values[0] : undefined;
}

function hasEvidence(field: string, value: string | undefined): boolean {
  if (
    !value ||
    /^(?:n\/?a\b|not (?:applicable|run|tested)\b|none\b|tbd\b|todo\b|pending\b)/iu.test(
      value,
    )
  )
    return false;
  const linked = (value.match(/https:\/\/[^\s<>()[\]]+/giu) ?? []).some(
    (reference) => {
      const url = URL.parse(reference);
      return (
        url !== null &&
        url.pathname.length > 1 &&
        url.username === "" &&
        url.password === "" &&
        url.hostname.includes(".") &&
        !/^(?:www\.)?example\.(?:com|net|org)$/iu.test(url.hostname)
      );
    },
  );
  if (field === "UI video") return linked;
  return (
    linked || (value.match(/[\p{L}\p{N}][\p{L}\p{N}_./-]*/gu)?.length ?? 0) >= 5
  );
}

export function hasSlopParticipationFooter(body: string): boolean {
  return visibleLines(body).includes(FOOTER);
}

export function missingSubmissionEvidence(
  body: string,
  policy: readonly { path: string; text: string; truncated: boolean }[],
): { source: string; quote: string; fields: string[] } | null {
  const guide = policy.find(
    ({ path, text, truncated }) =>
      !truncated &&
      /(?:^|\/)contributing\.md$/iu.test(path) &&
      visibleLines(text).includes(SECTION) &&
      [
        "Change types:",
        ...COMMON_FIELDS.map((field) => `${field}:`),
        ...[...CHANGE_FIELDS.values()].flatMap((field) =>
          field === null ? [] : [`${field}:`],
        ),
      ].every((field) => text.includes(field)),
  );
  if (!guide) return null;
  const lines = visibleLines(body);
  if (!lines.includes(FOOTER)) return null;
  const start = lines.indexOf(SECTION);
  const end = lines.findIndex(
    (line, index) =>
      index > start && (/^#{1,2}\s/u.test(line) || line.trimEnd() === FOOTER),
  );
  const section =
    start === -1 ? [] : lines.slice(start + 1, end === -1 ? undefined : end);
  const types =
    evidenceValue(section, "Change types")
      ?.split(",")
      .map((type) => type.trim()) ?? [];
  const validTypes =
    types.length > 0 &&
    types.every((type) => CHANGE_FIELDS.has(type)) &&
    (!types.includes("docs") || types.length === 1);
  const fields = [
    ...COMMON_FIELDS,
    ...new Set(types.flatMap((type) => CHANGE_FIELDS.get(type) ?? [])),
  ];
  const missing = fields.filter(
    (field) => !hasEvidence(field, evidenceValue(section, field)),
  );
  if (!validTypes) missing.unshift("Change types");
  return missing.length
    ? { source: guide.path, quote: SECTION, fields: missing }
    : null;
}
