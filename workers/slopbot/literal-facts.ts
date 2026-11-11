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

const WORD = "[0-9A-Za-z_]";
const DIGEST = new RegExp(`(?<!${WORD})[0-9a-f]{64}(?!${WORD})`, "g");
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
  const add = (pattern: RegExp, describe: (token: string) => string) => {
    const inItem = new Set(tokens(pattern, itemText));
    for (const token of new Set(tokens(pattern, cited))) {
      if (inItem.has(token)) facts.push(describe(token));
    }
  };
  add(
    DIGEST,
    (token) =>
      `\`${token}\` is a well-formed 64-character lowercase hex string, the form of a SHA-256 digest. Whether it is the digest of a particular file was not checked.`,
  );
  add(
    LITERAL,
    (token) =>
      `\`${token}\` is written as a hex integer literal (\`0x\` followed by ${token.length - 2} hex digit${token.length === 3 ? "" : "s"}), not as a name.`,
  );
  return facts.slice(0, LITERAL_FACT_LIMIT);
}
