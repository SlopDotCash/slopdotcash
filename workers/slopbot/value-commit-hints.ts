/** A link destination owns repository scope; its label cannot create a local
 * reference. Shared by commit and PR discovery. Each scan stops at the next
 * tag or bracket, so one comment is read in linear time.
 */
export function githubLinkDestinations(text: string): string {
  return text
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
    );
}

const label = (text: string) => text.trim().replace(/\s+/gu, " ").toLowerCase();

/** Prose is discovery only, including GitHub's /pull/N/commits/SHA route.
 * Any GitHub host spelling is scoped by its destination. A reference-style
 * label takes the scope of its definition, and user@SHA names that user's fork.
 */
export function sameRepositoryCommitHints(repository: string, text: string) {
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
