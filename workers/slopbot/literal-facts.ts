// Deterministic facts about hex tokens a review cites (issue #1930).
//
// The model has reported a 64-character SHA-256 digest as "not a sha256 hex
// value" and a Python literal such as 0x57738c8 as "an undefined name". These
// checks never change the verdict, category, summary or evidence. They add
// one line per cited token whose form can be decided without a model, so the
// author and the maintainer can see the contradiction and nothing is erased.
//
// A token is cited when it appears in the model's summary, evidence or
// limitations AND, with the same boundaries, in the reviewed item text. A
// token the model invented, or one that sits inside a longer identifier or a
// longer hex run in the item, yields no line.
//
// Each line states the token's form only. A pattern cannot tell whether a
// 0x token sits in code, a string, a comment or a URL, or whether a digest
// belongs to any file, so every line says what was not checked. Digests match
// in either letter case, and a digest the review cites in one case matches
// the same digest written in the other case in the item.

const WORD = "[0-9A-Za-z_]";
const DIGEST = new RegExp(`(?<!${WORD})[0-9A-Fa-f]{64}(?!${WORD})`, "g");
const LITERAL = new RegExp(`(?<!${WORD})0[xX][0-9A-Fa-f]+(?!${WORD})`, "g");

/** At most this many fact lines are published for one review. */
export const LITERAL_FACT_LIMIT = 6;

function tokens(pattern: RegExp, text: string): string[] {
  return [...text.matchAll(pattern)].map((match) => match[0]);
}

/** Fact lines for the hex tokens that both the review and the item contain. */
export function literalFacts(
  reviewText: readonly string[],
  itemText: string,
): string[] {
  const cited = reviewText.join("\n");
  const facts: string[] = [];
  const add = (
    pattern: RegExp,
    key: (token: string) => string,
    describe: (token: string) => string,
  ) => {
    const inItem = new Set(tokens(pattern, itemText).map(key));
    const seen = new Set<string>();
    for (const token of tokens(pattern, cited)) {
      const k = key(token);
      if (seen.has(k) || !inItem.has(k)) continue;
      seen.add(k);
      facts.push(describe(token));
    }
  };
  add(
    DIGEST,
    (token) => token.toLowerCase(),
    (token) =>
      `\`${token}\` is a well-formed 64-character hex string, the form of a SHA-256 digest. Whether it is the digest of a particular file was not checked.`,
  );
  add(
    LITERAL,
    (token) => token,
    (token) =>
      `\`${token}\` has the form of a hex integer literal (\`0x\` followed by ${token.length - 2} hex digit${token.length === 3 ? "" : "s"}). Whether it is used as a literal where it appears (and not inside a string, comment or URL) was not checked.`,
  );
  return facts.slice(0, LITERAL_FACT_LIMIT);
}
