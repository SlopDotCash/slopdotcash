// spec/contributor/reviewEpoch.md, "Each exact frozen head gets one disposition, including an explicit stale-head disposition"
import { createHash } from "node:crypto";
import type { Driver, Options } from "../../gen/contributor__reviewEpoch.conformance.ts";
import type { FrontierItem, ReviewEpoch } from "../../gen/contributor__reviewEpoch.ts";
import { scriptRoot } from "../support/scripts/fixture.ts";

interface Candidate {
  readonly number: number;
  readonly headSha: string;
}

interface Epoch {
  readonly candidates: ReadonlyArray<Candidate>;
  readonly deferred: ReadonlyArray<Candidate>;
}

interface Disposition {
  readonly number: number;
  readonly expectedHeadSha: string;
  readonly status: "merge" | "stale-head";
  readonly currentHeadSha?: string;
  readonly recommendationUrl?: string;
}

interface Completion {
  readonly allowsNextTier: boolean;
  readonly maxNextTierOutcomes: number;
}

interface LiveReport {
  createReviewEpoch(candidates: ReadonlyArray<Candidate & { readonly updatedAt: string }>, cutoff: string): Epoch;
  completeReviewEpoch(epoch: Epoch, dispositions: ReadonlyArray<Disposition>): Completion;
  recheckReviewEpochCandidate(candidate: Candidate, currentHeadSha: string): { readonly publishable: boolean };
}

const live = (await import(scriptRoot("review-epoch-driver").url)) as LiveReport;
const cutoff = "2026-11-10T00:00:00.000Z";
const beforeCutoff = "2026-11-09T00:00:00.000Z";
const afterCutoff = "2026-11-11T00:00:00.000Z";
const shaOf = (head: number) => createHash("sha1").update(String(head)).digest("hex");

interface Review {
  epoch: (Epoch & { readonly heads: ReadonlyMap<string, number> }) | undefined;
  dispositions: ReadonlyArray<Disposition>;
  permits: number;
}

const reviews = new Map<string, Review>();
const reviewOf = (key: string): Review => {
  const found = reviews.get(key);
  if (found !== undefined) return found;
  const made: Review = { epoch: undefined, dispositions: [], permits: 0 };
  reviews.set(key, made);
  return made;
};

const accepted = (run: () => void): "accepted" | "refused" => {
  try {
    run();
    return "accepted";
  } catch (error) {
    if (error instanceof TypeError) return "refused";
    throw error;
  }
};

const byItem = (state: ReviewEpoch): ReviewEpoch => ({ ...state, items: [...state.items].sort((left, right) => left.item - right.item) });

export const driver: Driver = {
  reset: () => reviews.clear(),
  dispatch: (key, event) => {
    const review = reviewOf(key);
    switch (event.type) {
      case "freeze": {
        if (review.epoch !== undefined || event.frontier.some((item) => item.disposed || item.stale || item.head <= 0)) return "refused";
        return accepted(() => {
          const candidates = event.frontier.map((item) => ({ number: item.item, headSha: shaOf(item.head), updatedAt: item.deferred ? afterCutoff : beforeCutoff }));
          review.epoch = { ...live.createReviewEpoch(candidates, cutoff), heads: new Map(event.frontier.map((item) => [shaOf(item.head), item.head])) };
        });
      }
      case "dispose": {
        const epoch = review.epoch;
        if (epoch === undefined) return "refused";
        return accepted(() => {
          const frozen = { number: event.itemId, headSha: shaOf(event.frozenHead) };
          const current = shaOf(event.currentHead);
          const disposition: Disposition = live.recheckReviewEpochCandidate(frozen, current).publishable
            ? { number: event.itemId, expectedHeadSha: frozen.headSha, status: "merge", recommendationUrl: `https://github.com/o/r/pull/${event.itemId}` }
            : { number: event.itemId, expectedHeadSha: frozen.headSha, status: "stale-head", currentHeadSha: current };
          const dispositions = [...review.dispositions, disposition];
          live.completeReviewEpoch(epoch, dispositions);
          if (review.permits > 0) throw new TypeError("the lower-tier outcome was already taken");
          review.dispositions = dispositions;
        });
      }
      case "permit": {
        const epoch = review.epoch;
        if (epoch === undefined) return "refused";
        const completion = live.completeReviewEpoch(epoch, review.dispositions);
        if (!completion.allowsNextTier || review.permits >= completion.maxNextTierOutcomes) return "refused";
        review.permits += 1;
        return "accepted";
      }
    }
  },
  observe: (key) => {
    const { epoch, dispositions, permits } = reviewOf(key);
    if (epoch === undefined) return byItem({ frozen: false, items: [], permitted: false });
    const headOf = (candidate: Candidate) => epoch.heads.get(candidate.headSha) ?? 0;
    const item = (candidate: Candidate, deferred: boolean): FrontierItem => {
      const disposition = deferred ? undefined : dispositions.find((entry) => entry.number === candidate.number);
      return { item: candidate.number, head: headOf(candidate), deferred, disposed: disposition !== undefined, stale: disposition?.status === "stale-head" };
    };
    return byItem({ frozen: true, items: [...epoch.candidates.map((candidate) => item(candidate, false)), ...epoch.deferred.map((candidate) => item(candidate, true))], permitted: permits > 0 });
  },
};

export const options: Options = { keys: ["epoch"], view: byItem };
