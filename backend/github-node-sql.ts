/**
 * SQL that resolves a GitHub user node ID to its numeric GitHub user ID, so
 * a join on the immutable numeric ID matches both node spellings GitHub
 * emits: legacy `MDQ6VXNl…` (base64 of `04:User<id>`) and current `U_kgDO…`
 * or `U_kgDP…` (base64url of the MessagePack `[0, uint32|uint64 id]`). The
 * same person can appear under either spelling in different records, so a
 * join on the raw node string misses records. `githubUserIdFromNodeId` in
 * `src/lib/github-actor.ts` is the strict TypeScript decoder; this expression
 * yields the same ID for each canonical spelling and NULL for anything that
 * is not a user node ID. SQLite has no base64 function, so the decoding is
 * unrolled over the bounded ID length.
 */
const STANDARD =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const URL_SAFE =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Six-bit value of the character at 1-based `position`; -1 when absent. */
function sextet(node: string, position: number, alphabet: string): string {
  return `(instr('${alphabet}', substr(${node}, ${position}, 1)) - 1)`;
}

/** Legacy: `MDQ6VXNl` is the fixed base64 of `04:Use`; the rest is `r<id>`. */
function legacyId(node: string): string {
  const groups: string[] = [];
  // `r` plus at most 16 digits is 17 bytes: six base64 groups.
  for (let group = 0; group < 6; group++) {
    const start = 9 + group * 4;
    const [a, b, c, d] = [0, 1, 2, 3].map((offset) =>
      sextet(node, start + offset, STANDARD),
    );
    groups.push(`CASE WHEN length(${node}) >= ${start + 3} THEN
      char((${a} << 2) | (${b} >> 4))
      || CASE WHEN ${c} >= 0 THEN char(((${b} & 15) << 4) | (${c} >> 2)) ELSE '' END
      || CASE WHEN ${d} >= 0 THEN char(((${c} & 3) << 6) | ${d}) ELSE '' END
    ELSE '' END`);
  }
  const tail = groups.join(" || ");
  return `(SELECT CASE WHEN substr(t, 1, 1) = 'r' AND substr(t, 2) GLOB '[1-9]*'
      AND substr(t, 2) NOT GLOB '*[^0-9]*' AND length(t) <= 17
    THEN substr(t, 2) END FROM (SELECT ${tail} AS t))`;
}

/** Current: a fixed `kgDO` (uint32) or `kgDP` (uint64) MessagePack prefix. */
function currentId(node: string): string {
  const bits = (count: number) =>
    Array.from(
      { length: count },
      (_, index) =>
        `(${sextet(node, 7 + index, URL_SAFE)} << ${6 * (count - 1 - index)})`,
    ).join(" | ");
  const valid = (count: number) =>
    Array.from(
      { length: count },
      (_, index) => `${sextet(node, 7 + index, URL_SAFE)} >= 0`,
    ).join(" AND ");
  // Six characters carry 36 bits for 32; eleven carry 66 bits for 64. The
  // uint64 form is evaluated as the low 64 bits of the first ten characters
  // plus the top four bits of the eleventh; a zero first character keeps it
  // exact (the ID is below 2^58).
  return `CASE
    WHEN substr(${node}, 1, 6) = 'U_kgDO' AND length(${node}) = 12 AND ${valid(6)}
      THEN CAST(((${bits(6)}) >> 4) AS TEXT)
    WHEN substr(${node}, 1, 6) = 'U_kgDP' AND length(${node}) = 17 AND ${valid(11)}
      AND ${sextet(node, 7, URL_SAFE)} = 0
      THEN CAST((((${bits(10)}) << 4) | (${sextet(node, 16 + 1, URL_SAFE)} >> 2)) AS TEXT)
  END`;
}

/** The numeric GitHub user ID (TEXT) for a node ID expression, or NULL. */
export function githubUserIdFromNodeIdSql(node: string): string {
  return `(SELECT CASE
    WHEN substr(n, 1, 8) = 'MDQ6VXNl' THEN ${legacyId("n")}
    WHEN substr(n, 1, 2) = 'U_' THEN ${currentId("n")}
  END FROM (SELECT ${node} AS n))`;
}
