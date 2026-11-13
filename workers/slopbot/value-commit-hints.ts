/** A link destination owns repository scope; its label cannot create a local
 * reference. Shared by commit and PR discovery. Each scan stops at the next
 * tag or bracket, so one comment is read in linear time.
 */
function normalizeGithubHosts(text: string): string {
  return text.replace(
    /(?<![\w./-])(?:https?:\/\/)?(?:[A-Za-z0-9-]+\.)*github\.com\//giu,
    "https://github.com/",
  );
}

function canonicalGithubUrl(raw: string): string {
  return raw.replace(
    /^(?:https?:\/\/)?(?:[A-Za-z0-9-]+\.)*github\.com\//iu,
    "https://github.com/",
  );
}

export function githubLinkDestinations(text: string): string {
  return normalizeGithubHosts(text)
    .replace(
      /<a\b([^<>]*)>(?:(?!<\/?a\b)[\s\S])*<\/a>/giu,
      (anchor, attributes: string) => {
        const href = /\bhref=(["'])(https:\/\/github\.com\/[^"']+)\1/iu.exec(
          attributes,
        )?.[2];
        return href === undefined ? anchor : canonicalGithubUrl(href);
      },
    )
    .replace(
      /\[[^[\]\n]*\]\(\s*<?(https:\/\/github\.com\/[^<>\s)"']+)>?(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/gu,
      (_link, destination: string) => canonicalGithubUrl(destination),
    );
}

const label = (text: string) => text.trim().replace(/\s+/gu, " ").toLowerCase();

/** Fenced samples are not references. GitHub does not autolink inside them,
 * including a fence quoted or opened under a list marker. */
function withoutFencedCode(text: string): string {
  let fence: { marker: string; length: number } | null = null;
  const kept: string[] = [];
  for (const physical of text.split("\n")) {
    const carriage = physical.endsWith("\r");
    const line = carriage ? physical.slice(0, -1) : physical;
    const delimiter =
      /^ {0,3}(?:> {0,3})*(?:(?:[-*+]|\d+[.)])\s+)?(`{3,}|~{3,})(.*)$/u.exec(
        line,
      );
    if (delimiter) {
      const marker = delimiter[1];
      if (fence === null) fence = { marker: marker[0], length: marker.length };
      else if (
        marker[0] === fence.marker &&
        marker.length >= fence.length &&
        delimiter[2].trim().length === 0
      )
        fence = null;
      kept.push(carriage ? "\r" : "");
      continue;
    }
    kept.push(fence === null ? physical : carriage ? "\r" : "");
  }
  return kept.join("\n");
}

/** Text safe for commit and pull-request discovery. Link labels, titles,
 * reference-style labels, and fenced samples cannot create a local number or
 * digest; a GitHub destination keeps its own repository scope.
 */
export function githubReferenceText(text: string): string {
  const visible = githubLinkDestinations(withoutFencedCode(text))
    .replace(
      /\[[^[\]\n]*\]\(\s*<?[^<>\s)"']*>?(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/gu,
      " ",
    )
    .replace(/<a\b[^<>]*>(?:(?!<\/?a\b)[\s\S])*<\/a>/giu, " ");
  const definitions = new Set(
    [...visible.matchAll(/^ {0,3}\[([^[\]\n]+)\]:/gmu)].map((match) =>
      label(match[1]),
    ),
  );
  return visible.replace(
    /\[([^[\]\n]*)\](\[[^[\]\n]*\])?/gu,
    (link, content: string, reference?: string) =>
      reference !== undefined || definitions.has(label(content)) ? " " : link,
  );
}

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
  const referencesText = githubReferenceText(text).replace(
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
