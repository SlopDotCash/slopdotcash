/** Prose is discovery only. A link destination owns repository scope, including
 * GitHub's /pull/N/commits/SHA route; its label cannot create a local reference.
 */
export function sameRepositoryCommitHints(repository: string, text: string) {
  const referencesText = text
    .replace(
      /<a\b[^>]*\bhref=(["'])(https:\/\/(?:redirect\.)?github\.com\/[^"']+)\1[^>]*>[\s\S]*?<\/a>/giu,
      "$2",
    )
    .replace(
      /\[[^\]\n]*\]\((https:\/\/(?:redirect\.)?github\.com\/[^\s)]+)\)/gu,
      "$1",
    )
    .replace(
      /https:\/\/(?:redirect\.)?github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:[/?#][^\s<>"')]*|\b)/gu,
      (url, target: string) =>
        target.toLowerCase() === repository.toLowerCase() ? url : " ",
    );
  return [
    ...new Set(
      [
        ...referencesText.matchAll(
          /(?:https:\/\/(?:redirect\.)?github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:commit|blob|tree|pull\/\d+\/commits)\/|([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@)?\b([a-f0-9]{7,40})\b/gu,
        ),
      ]
        .filter(
          (match) =>
            (match[1] ?? repository).toLowerCase() === repository.toLowerCase(),
        )
        .map((match) => match[2]),
    ),
  ];
}
