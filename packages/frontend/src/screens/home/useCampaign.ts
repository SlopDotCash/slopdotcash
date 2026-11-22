// spec/frontend/presentation.md, "The campaign keeps one stable accessible heading and respects reduced motion"; spec/frontend/presentation.md, "Home offers a Contributor / Maintainer switch whose journey sets the heading, the prompt and every agent's skill address together"
import { Effect } from "effect";
import { useSyncExternalStore } from "react";
import { campaignOf, type HomeAudience, type Motion } from "../../../gen/frontend__presentation.ts";
import { type Campaign, type CampaignFrame, firstFrameOf } from "./campaign.ts";
import { typeCampaign } from "./typing.vibe";

const reducedMotion = "(prefers-reduced-motion: reduce)";

const motionQuery = (): MediaQueryList | undefined => (typeof matchMedia === "undefined" ? undefined : matchMedia(reducedMotion));

const subscribeMotion = (notify: () => void) => {
  const query = motionQuery();
  query?.addEventListener("change", notify);
  return () => query?.removeEventListener("change", notify);
};

const currentMotion = (): Motion => (motionQuery()?.matches === false ? "NormalMotion" : "ReducedMotion");

const staticMotion = (): Motion => "ReducedMotion";

export function useMotion(): Motion {
  return useSyncExternalStore(subscribeMotion, currentMotion, staticMotion);
}

interface CampaignStore {
  readonly subscribe: (notify: () => void) => () => void;
  readonly current: () => CampaignFrame;
  readonly resting: () => CampaignFrame;
}

function storeOf(campaign: Campaign): CampaignStore {
  const first = firstFrameOf(campaign);
  let shown = first;
  let stop: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (frame: CampaignFrame) =>
    Effect.sync(() => {
      shown = frame;
      for (const listener of listeners) listener();
    });
  return {
    subscribe: (notify) => {
      listeners.add(notify);
      if (!stop) {
        const fiber = Effect.runFork(typeCampaign(campaign, publish));
        stop = () => fiber.interruptUnsafe();
      }
      return () => {
        listeners.delete(notify);
        if (listeners.size > 0) return;
        stop?.();
        stop = undefined;
        shown = first;
      };
    },
    current: () => shown,
    resting: () => first,
  };
}

const stores: Record<HomeAudience, CampaignStore> = { Contributor: storeOf(campaignOf("Contributor")), Maintainer: storeOf(campaignOf("Maintainer")) };

const still = () => () => undefined;

export function useCampaignFrame(journey: HomeAudience, animated: boolean): CampaignFrame {
  const store = stores[journey];
  return useSyncExternalStore(animated ? store.subscribe : still, animated ? store.current : store.resting, store.resting);
}
