// spec/backend/identity.md, "Time advances and the hourly job removes only expired rows"
import { Clock, Effect, Layer } from "effect";

export interface SettableClock {
  readonly layer: Layer.Layer<never>;
  /** @throws {never} */
  set(millis: number): void;
  /** @throws {never} */
  advance(millis: number): void;
  /** @throws {never} */
  now(): number;
}

/** @throws {never} */
export function settableClock(start: number): SettableClock {
  let now = start;
  const nanos = () => BigInt(now) * 1_000_000n;
  const live = Clock.Clock.defaultValue();
  const clock: Clock.Clock = {
    currentTimeMillisUnsafe: () => now,
    currentTimeMillis: Effect.sync(() => now),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: nanos,
    monotonicTimeNanos: Effect.sync(nanos),
    sleep: (duration) => live.sleep(duration),
  };
  return {
    layer: Layer.succeed(Clock.Clock, clock),
    set: (millis) => { now = millis; },
    advance: (millis) => { now += millis; },
    now: () => now,
  };
}
