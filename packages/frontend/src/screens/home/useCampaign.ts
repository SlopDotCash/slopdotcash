// spec/frontend/presentation.md, "The campaign keeps one stable accessible heading and respects reduced motion"
import { Effect } from "effect";
import { useSyncExternalStore } from "react";
import type { Motion } from "../../../gen/frontend__presentation.ts";
import { type CampaignFrame, firstFrame } from "./campaign.ts";
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

let shown: CampaignFrame = firstFrame;
let stop: (() => void) | undefined;
const listeners = new Set<() => void>();

const publish = (frame: CampaignFrame) =>
  Effect.sync(() => {
    shown = frame;
    for (const listener of listeners) listener();
  });

const subscribeCampaign = (notify: () => void) => {
  listeners.add(notify);
  if (!stop) {
    const fiber = Effect.runFork(typeCampaign(publish));
    stop = () => fiber.interruptUnsafe();
  }
  return () => {
    listeners.delete(notify);
    if (listeners.size > 0) return;
    stop?.();
    stop = undefined;
    shown = firstFrame;
  };
};

const still = () => () => undefined;

const currentFrame = () => shown;

const restingFrame = () => firstFrame;

export function useCampaignFrame(animated: boolean): CampaignFrame {
  return useSyncExternalStore(animated ? subscribeCampaign : still, animated ? currentFrame : restingFrame, restingFrame);
}
