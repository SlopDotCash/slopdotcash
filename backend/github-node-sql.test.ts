import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { githubUserIdFromNodeId } from "../src/lib/github-actor";
import { githubUserIdFromNodeIdSql } from "./github-node-sql";

function legacy(id: bigint): string {
  return btoa(`04:User${id}`);
}

function current(id: bigint): string {
  const width = id <= 0xff_ff_ff_ffn ? 4 : 8;
  const bytes = new Uint8Array(3 + width);
  bytes.set([0x92, 0x00, width === 4 ? 0xce : 0xcf]);
  let rest = id;
  for (let i = width - 1; i >= 0; i--) {
    bytes[3 + i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return `U_${btoa(String.fromCharCode(...bytes))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "")}`;
}

function resolve(nodes: string[]): (string | null)[] {
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE nodes(position INTEGER PRIMARY KEY, node TEXT)");
    const insert = db.query("INSERT INTO nodes(node) VALUES(?)");
    for (const node of nodes) insert.run(node);
    return db
      .query<{ id: string | null }, []>(
        `SELECT ${githubUserIdFromNodeIdSql("nodes.node")} AS id FROM nodes ORDER BY position`,
      )
      .all()
      .map((row) => row.id);
  } finally {
    db.close();
  }
}

describe("GitHub node ID resolution in SQL", () => {
  test("both spellings of one person resolve to the same numeric ID as the strict decoder", () => {
    const ids = [
      1n,
      9n,
      42n,
      99n,
      100n,
      1000n,
      12345n,
      18633264n,
      123456789n,
      2147483648n,
      4294967295n,
      4294967296n,
      9007199254740991n,
    ];
    for (let seed = 7n; ids.length < 200; seed = (seed * 48271n) % 2147483647n)
      ids.push(seed);
    const nodes = ids.flatMap((id) => [legacy(id), current(id)]);
    const resolved = resolve(nodes);
    nodes.forEach((node, index) => {
      expect(githubUserIdFromNodeId(node)).toBe(String(ids[index >> 1]));
      expect(resolved[index]).toBe(String(ids[index >> 1]));
    });
  });

  test("organization, malformed and foreign IDs never name a user", () => {
    expect(
      resolve([
        btoa("04:Organization42"),
        btoa("04:User0"),
        btoa("04:User4x"),
        "MDQ6VXNl",
        "U_kgDO",
        "U_kgDO***---",
        "O_kgDOABCD",
        "PR_kwDOAB",
        "",
      ]),
    ).toEqual([null, null, null, null, null, null, null, null, null]);
  });
});
