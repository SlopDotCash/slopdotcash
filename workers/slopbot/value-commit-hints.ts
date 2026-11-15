/** A link destination owns repository scope; its label cannot create a local
 * reference. Shared by commit and PR discovery. Each scan stops at the next
 * tag or bracket, so one comment is read in linear time.
 */
export function githubLinkDestinations(text: string): string {
  return (
    text
      // Relative documentation links name local files and headings. Neither the
      // label nor a numeric heading fragment is an outgoing GitHub reference.
      .replace(
        /\[[^[\]\n]*\]\(\s*(<[^<>\n]*>|(?:\\.|[^\s()])+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?\s*\)/gu,
        (link, rawDestination: string, offset: number) => {
          let escapes = 0;
          for (let index = offset - 1; text[index] === "\\"; index--) escapes++;
          if (escapes % 2 === 1) return link;
          const destination = rawDestination.startsWith("<")
            ? rawDestination.slice(1, -1)
            : rawDestination;
          const local =
            !destination.startsWith("//") &&
            !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(destination);
          const path = destination.split(/[?#]/u, 1)[0];
          return local && /\.md$/iu.test(path) ? " " : link;
        },
      )
      .replace(
        /<a\b([^<>]*)>(?:(?!<\/?a\b)[\s\S])*<\/a>/giu,
        (anchor, attributes: string) =>
          /\bhref=(["'])(https:\/\/(?:redirect\.)?github\.com\/[^"']+)\1/iu.exec(
            attributes,
          )?.[2] ?? anchor,
      )
      .replace(
        /\[[^[\]\n]*\]\((https:\/\/(?:redirect\.)?github\.com\/[^\s)[\]]+)\)/gu,
        "$1",
      )
  );
}

const label = (text: string) => text.trim().replace(/\s+/gu, " ").toLowerCase();

/** Prose is discovery only, including GitHub's /pull/N/commits/SHA route.
 * Any GitHub host spelling is scoped by its destination. A reference-style
 * label takes the scope of its definition, and user@SHA names that user's fork.
 */
export function sameRepositoryCommitHints(repository: string, text: string) {
  // Attribution and skill revisions identify the agent, not an integration.
  // Exclude them only from discovery; callers retain the original evidence.
  text = text
    .replace(
      /<!--\s*(?:(?:elizaos-contribution|eliza-computer)-attribution:v[12]|slop-contribution-attribution:v1)\b[\s\S]*?-->/giu,
      "",
    )
    .replace(
      /^\s*(?:[-*+]\s+)?(?:\*\*)?(?:Contribution skill revision|Skill revision)(?:\*\*)?\s*:[^\r\n]*/gimu,
      "",
    );
  const local = (target: string) =>
    target.toLowerCase() === repository.toLowerCase();
  const name = repository.split("/")[1];
  const definitions = new Set(
    [...text.matchAll(/^ {0,3}\[([^[\]\n]+)\]:/gmu)].map((m) => label(m[1])),
  );
  const referencesText = githubLinkDestinations(
    text
      .replace(
        /(?<![\w./-])(?:https?:\/\/)?(?:[A-Za-z0-9-]+\.)*github\.com\//giu,
        "https://github.com/",
      )
      .replace(/\]\(<(https:\/\/github\.com\/[^<>\n]*)>\)/gu, "]($1)"),
  )
    .replace(
      /\[([^[\]\n]*)\](\[[^[\]\n]*\])?/gu,
      (link, content: string, reference?: string) =>
        reference !== undefined || definitions.has(label(content)) ? " " : link,
    )
    .replace(
      /https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:[/?#][^\s<>"')]*|\b)/gu,
      (url, target: string) => (local(target) ? url : " "),
    );
  return [
    ...new Set(
      [
        ...referencesText.matchAll(
          /(?:https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:commit|blob|tree|pull\/\d+\/commits)\/|(?<![\w./-])([\w./-]+)@|(?<!@))\b([a-f0-9]{7,40})\b/gu,
        ),
      ]
        .filter(
          ([, scope]) =>
            scope === undefined ||
            local(scope.includes("/") ? scope : `${scope}/${name}`),
        )
        .map((match) => match[2]),
    ),
  ];
}

/** Closed Markdown fenced code blocks are literal examples, not outgoing prose
 * references. Unclosed fences remain visible to discovery conservatively.
 */
export function withoutClosedCodeFences(text: string): string {
  const lines = text.split(/(?<=\n)/u);
  const output: string[] = [];
  let pending: string[] = [];
  let marker = "";
  let length = 0;
  for (const line of lines) {
    if (marker) {
      pending.push(line);
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*(?:\r?\n)?$/u.exec(line);
      if (closing && closing[1][0] === marker && closing[1].length >= length) {
        output.push("\n".repeat(pending.length));
        pending = [];
        marker = "";
      }
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)/u.exec(line);
    if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
      marker = opening[1][0];
      length = opening[1].length;
      pending = [line];
    } else output.push(line);
  }
  output.push(...pending);
  return output.join("");
}

/** Only matching unescaped backtick runs delimit inline code. Preserve an
 * unmatched opener so a malformed example cannot hide a real reference.
 */
export function withoutClosedCodeSpans(text: string): string {
  const runs: { start: number; end: number; escaped: boolean }[] = [];
  for (const match of text.matchAll(/`+/gu)) {
    let escapes = 0;
    for (
      let index = match.index - 1;
      index >= 0 && text[index] === "\\";
      index--
    )
      escapes++;
    runs.push({
      start: match.index,
      end: match.index + match[0].length,
      escaped: escapes % 2 === 1,
    });
  }
  const nextByLength = new Map<number, number>();
  const closing = new Map<number, number>();
  for (let index = runs.length - 1; index >= 0; index--) {
    const run = runs[index];
    const length = run.end - run.start;
    const next = nextByLength.get(length);
    if (next !== undefined) closing.set(index, next);
    // Backslashes are literal inside code, so even an escaped run may close it.
    nextByLength.set(length, index);
  }
  const output: string[] = [];
  let cursor = 0;
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index];
    if (run.escaped) continue;
    const end = closing.get(index);
    if (end === undefined) continue;
    output.push(text.slice(cursor, run.start), " ");
    cursor = runs[end].end;
    index = end;
  }
  output.push(text.slice(cursor));
  return output.join("");
}
