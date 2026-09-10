import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildFundingReviewIndex } from "../scripts/prepare-funding-review";
import {
  allocateFundingReview,
  assertFundingPreparation,
  assertFundingReviewIndex,
  createFundingReview,
} from "../src/lib/funding-review-data";

const root = process.cwd();
async function preparation() {
  return assertFundingPreparation(
    JSON.parse(
      await readFile(`${root}/funding/preparations/eliza-2026-08.json`, "utf8"),
    ),
  );
}
describe("funding preparation", () => {
  it("retains the complete audited census, including missing wallets and external prizes", async () => {
    const index = await buildFundingReviewIndex(root);
    const rows = index.reviews.flatMap((r) => r.contributors);
    expect(rows).toHaveLength(138);
    expect(new Set(rows.map((r) => r.actor.id)).size).toBe(113);
    expect(
      new Set(rows.filter((r) => r.wallet === null).map((r) => r.actor.id))
        .size,
    ).toBe(56);
    for (const review of index.reviews) {
      expect(review.status).toBe("preparation");
      expect(review.paymentAuthorized).toBe(false);
      expect(review.proposalPublished).toBe(false);
      if (review.rewardKind === "monthly-pool") {
        expect(
          review.contributors
            .reduce((s, r) => s + BigInt(r.simulatedMinor ?? "0"), 0n)
            .toString(),
        ).toBe(review.capMinor);
        expect(
          review.contributors
            .filter((r) => r.wallet === null)
            .every((r) => BigInt(r.simulatedMinor ?? "0") > 0n),
        ).toBe(true);
      } else {
        expect(review.capMinor).toBeNull();
        expect(
          review.contributors.every((r) => r.simulatedMinor === null),
        ).toBe(true);
        expect(review.contributors[0].externalSharePartsPerMillion).toBe(
          "900000",
        );
      }
    }
  });
  it("uses exact largest remainder and stable actor tie breaks beyond safe-number totals", async () => {
    const p = await preparation();
    const rows = p.contributors.slice(0, 3).map((r, i) => ({
      ...r,
      actor: { id: String(i), login: ["z", "a", "b"][i] },
      weight: "1",
    }));
    const total = 10000000000000000000n;
    const allocated = allocateFundingReview(total, rows);
    expect(allocated.get("1")).toBe("3333333333333333334");
    expect([...allocated.values()].reduce((s, r) => s + BigInt(r), 0n)).toBe(
      total,
    );
    expect(
      Object.fromEntries(allocateFundingReview(total, [...rows].reverse())),
    ).toEqual(Object.fromEntries(allocated));
  });
  it("rejects private extra fields, incomplete periods, missing rows, duplicate actors and mismatched wallet proofs", async () => {
    const p = await preparation();
    expect(() =>
      assertFundingPreparation({ ...p, privateTrace: "secret" }),
    ).toThrow();
    expect(() =>
      assertFundingPreparation({
        ...p,
        provenance: {
          ...p.provenance,
          snapshotFrom: "2026-08-02T00:00:00.000Z",
        },
      }),
    ).toThrow();
    expect(() =>
      assertFundingPreparation({ ...p, contributors: p.contributors.slice(1) }),
    ).toThrow();
    expect(() =>
      assertFundingPreparation({
        ...p,
        contributors: [...p.contributors, p.contributors[0]],
      }),
    ).toThrow();
    const row = p.contributors.find(
      (r) => r.wallet && "sourceActorId" in r.wallet,
    );
    if (!row?.wallet) throw new Error("Expected claim fixture");
    expect(() =>
      assertFundingPreparation({
        ...p,
        contributors: p.contributors.map((r) =>
          r === row
            ? { ...r, wallet: { ...r.wallet, sourceActorId: "another" } }
            : r,
        ),
      }),
    ).toThrow();
  });
  it("revalidates canonical caps, integer allocations, status and unique project periods on browser load", async () => {
    const review = createFundingReview(await preparation());
    const index = {
      schemaVersion: "1",
      generatedAt: review.observedAt,
      reviews: [review],
    };
    expect(assertFundingReviewIndex(index)).toEqual(index);
    for (const patch of [
      { capMinor: "1" },
      { status: "approved" },
      { paymentAuthorized: true },
      { proposalPublished: true },
    ])
      expect(() =>
        assertFundingReviewIndex({
          ...index,
          reviews: [{ ...review, ...patch }],
        }),
      ).toThrow();
    expect(() =>
      assertFundingReviewIndex({ ...index, reviews: [review, review] }),
    ).toThrow();
    expect(() =>
      assertFundingReviewIndex({
        ...index,
        reviews: [
          {
            ...review,
            contributors: review.contributors.map((r, i) =>
              i === 0 ? { ...r, simulatedMinor: "0" } : r,
            ),
          },
        ],
      }),
    ).toThrow();
  });
});

it("keeps unavailable wallet lookups explicit without dropping the simulated share", async () => {
  const p = await preparation();
  const row = p.contributors.find((r) => r.wallet === null);
  if (!row) throw new Error("Expected missing-wallet fixture");
  const changed = {
    ...p,
    contributors: p.contributors.map((r) =>
      r === row ? { ...r, lookupUnavailable: true } : r,
    ),
  };
  const review = createFundingReview(changed);
  expect(
    review.contributors.find((r) => r.actor.id === row.actor.id)
      ?.lookupUnavailable,
  ).toBe(true);
  expect(
    review.contributors.find((r) => r.actor.id === row.actor.id)
      ?.simulatedMinor,
  ).toBe(
    createFundingReview(p).contributors.find((r) => r.actor.id === row.actor.id)
      ?.simulatedMinor,
  );
  const registered = p.contributors.find((r) => r.wallet !== null);
  expect(() =>
    assertFundingPreparation({
      ...p,
      contributors: p.contributors.map((r) =>
        r === registered ? { ...r, lookupUnavailable: true } : r,
      ),
    }),
  ).toThrow();
});
