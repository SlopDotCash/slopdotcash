import { expect, test } from "bun:test";
import {
  githubUserIdFromNodeId,
  sameGithubUser,
} from "../src/lib/github-actor";

const legacy = Buffer.from("04:User1").toString("base64");
const modern = `U_${Buffer.from([0x92, 0, 0xce, 0, 0, 0, 1]).toString("base64url")}`;
const other = `U_${Buffer.from([0x92, 0, 0xce, 0, 0, 0, 2]).toString("base64url")}`;

test("profile identity joins only canonical spellings of the same immutable user", () => {
  expect(githubUserIdFromNodeId(legacy)).toBe("1");
  expect(githubUserIdFromNodeId(modern)).toBe("1");
  expect(sameGithubUser(legacy, modern)).toBe(true);
  expect(sameGithubUser(modern, legacy)).toBe(true);
  expect(githubUserIdFromNodeId(other)).toBe("2");
  expect(sameGithubUser(legacy, other)).toBe(false);
  expect(sameGithubUser(modern, other)).toBe(false);
  for (const invalid of [
    legacy.replace(/=+$/u, ""),
    `${modern}=`,
    "U_kgAB",
    "not-a-node-id",
  ]) {
    expect(githubUserIdFromNodeId(invalid)).toBeNull();
    expect(sameGithubUser(legacy, invalid)).toBe(false);
    expect(sameGithubUser(invalid, legacy)).toBe(false);
  }
  expect(sameGithubUser(legacy, legacy)).toBe(true);
});
