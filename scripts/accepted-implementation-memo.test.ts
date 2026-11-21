import { expect, test } from "bun:test";
import { sha256Hex } from "../src/lib/sha256";
import type { AcceptedImplementationSource } from "./accepted-implementation-digests";
import { ImplementationMemo } from "./accepted-implementation-memo";

const repo = "R_eliza";
const codeDigest = "c".repeat(64);
const at = "2026-11-01T00:00:00.000Z";
const prior = {
  id: "PR_one",
  number: 9,
  url: "https://github.com/elizaOS/eliza/pull/9",
  mergedAt: "2026-10-01T00:00:00.000Z",
};
const source: AcceptedImplementationSource = {
  id: prior.id,
  headSha: "a".repeat(40),
  mergeSha: "b".repeat(40),
  mergeParentShas: ["1".repeat(40), "a".repeat(40)],
  mergeTreeSha: "2".repeat(40),
  firstParentTreeSha: "3".repeat(40),
};
const digest = "d".repeat(64);
const observation = { kind: "candidate", shape: "18/47/0", source } as const;

test("restored evidence is reusable only with the same public identity and native acceptance", () => {
  const memo = new ImplementationMemo();
  memo.rememberPrevious(repo, prior, observation);
  memo.rememberDigest(repo, source, digest);
  const bytes = memo.serialize(codeDigest, at);
  const restored = ImplementationMemo.parse(bytes, codeDigest, new Date(at));
  expect(restored.previous(repo, prior)).toEqual(observation);
  expect(restored.previous(repo, { ...prior, mergedAt: at })).toBeUndefined();
  expect(restored.previous("R_other", prior)).toBeUndefined();
  expect(restored.digest(repo, source)).toBe(digest);
  expect(restored.digest("R_other", source)).toBeUndefined();
  expect(
    restored.digest(repo, {
      ...source,
      mergeParentShas: ["4".repeat(40), source.headSha],
    }),
  ).toBeUndefined();
  expect(
    restored.digest(repo, {
      ...source,
      firstParentTreeSha: "4".repeat(40),
    }),
  ).toBeUndefined();
  expect(restored.serialize(codeDigest, at)).toBe(bytes);
});

test("recollection discards only observations made in the failed pass", () => {
  const memo = new ImplementationMemo();
  memo.rememberPrevious(repo, prior, observation);
  const restored = ImplementationMemo.parse(
    memo.serialize(codeDigest, at),
    codeDigest,
    new Date(at),
  );
  const current = {
    ...prior,
    id: "PR_current",
    number: 10,
    url: "https://github.com/elizaOS/eliza/pull/10",
  };
  const currentSource = { ...source, id: current.id };
  const currentObservation = { ...observation, source: currentSource };
  restored.rememberPrevious(repo, current, currentObservation);
  restored.rememberDigest(repo, currentSource, digest);
  expect(restored.previous(repo, current)).toEqual(currentObservation);
  restored.beginPass();
  expect(restored.previous(repo, current)).toBeUndefined();
  expect(restored.previous(repo, prior)).toEqual(observation);
  expect(restored.digest(repo, currentSource)).toBe(digest);
});

test("copying forward a memo cannot re-age an explicit negative observation", () => {
  const memo = new ImplementationMemo();
  memo.rememberPrevious(repo, prior, { kind: "ineligible" });
  memo.rememberDigest(repo, source, digest);
  const bytes = memo.serialize(codeDigest, at);
  const nextAt = "2026-11-06T00:00:00.000Z";
  const next = ImplementationMemo.parse(bytes, codeDigest, new Date(nextAt));
  expect(next.previous(repo, prior)).toEqual({ kind: "ineligible" });
  const latest = ImplementationMemo.parse(
    next.serialize(codeDigest, nextAt),
    codeDigest,
    new Date("2026-11-09T00:00:00.000Z"),
  );
  expect(latest.previous(repo, prior)).toBeUndefined();
  expect(latest.digest(repo, source)).toBe(digest);
});

test("only an exact native proof can preserve an old prior identity", () => {
  const memo = new ImplementationMemo();
  const unproven = {
    ...prior,
    id: "PR_unproven",
    number: 11,
    url: "https://github.com/elizaOS/eliza/pull/11",
  };
  memo.rememberPrevious(repo, prior, observation);
  memo.rememberPrevious(repo, unproven, {
    ...observation,
    source: { ...source, id: unproven.id },
  });
  memo.rememberDigest(repo, source, digest);
  const nextAt = "2026-11-07T00:00:00.000Z";
  const next = ImplementationMemo.parse(
    memo.serialize(codeDigest, at),
    codeDigest,
    new Date(nextAt),
  );
  const latest = ImplementationMemo.parse(
    next.serialize(codeDigest, nextAt),
    codeDigest,
    new Date("2026-11-09T00:00:00.000Z"),
  );
  expect(latest.previous(repo, prior)).toEqual(observation);
  expect(latest.previous(repo, unproven)).toBeUndefined();
  expect(latest.previous("R_other", prior)).toBeUndefined();
});

test("invalid or contradictory trusted evidence cannot become a cache hit", () => {
  const memo = new ImplementationMemo();
  memo.rememberPrevious(repo, prior, observation);
  memo.rememberDigest(repo, source, digest);
  const bytes = memo.serialize(codeDigest, at);
  expect(() =>
    ImplementationMemo.parse(bytes, "e".repeat(64), new Date(at)),
  ).toThrow("version or code digest");
  expect(() =>
    ImplementationMemo.parse(
      bytes,
      codeDigest,
      new Date("2026-10-30T00:00:00.000Z"),
    ),
  ).toThrow("stale or future artifact");
  expect(() =>
    ImplementationMemo.parse(
      bytes,
      codeDigest,
      new Date("2026-11-09T00:00:00.000Z"),
    ),
  ).toThrow("stale or future artifact");
  expect(() => memo.rememberDigest(repo, source, sha256Hex(""))).toThrow(
    "empty or contradictory",
  );
  expect(() => memo.rememberDigest(repo, source, "f".repeat(64))).toThrow(
    "empty or contradictory",
  );
  const edited = JSON.parse(bytes);
  edited.previous[0].observation.source.id = "PR_other";
  expect(() =>
    ImplementationMemo.parse(JSON.stringify(edited), codeDigest, new Date(at)),
  ).toThrow("candidate pull request identity");
  edited.previous[0].observation = {
    kind: "ineligible",
    reason: "missing response",
  };
  expect(() =>
    ImplementationMemo.parse(JSON.stringify(edited), codeDigest, new Date(at)),
  ).toThrow("unexpected fields");
});
