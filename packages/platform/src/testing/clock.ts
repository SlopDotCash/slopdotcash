// spec/backend/identity.md, "Time advances and the hourly job removes only expired rows"
import { Clock, Duration, Effect, Layer, Option } from "effect";

export interface SettableClock {
  readonly layer: Layer.Layer<never>;
  /** @throws {never} */
  set(millis: number): void;
  /** @throws {never} */
  advance(millis: number): void;
  /** @throws {never} */
  now(): number;
}

function clockOf(millis: () => number, nanos: () => bigint, sleep: Clock.Clock["sleep"]): Clock.Clock {
  return {
    currentTimeMillisUnsafe: millis,
    currentTimeMillis: Effect.sync(millis),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: nanos,
    monotonicTimeNanos: Effect.sync(nanos),
    sleep,
  };
}

/** @throws {never} */
export function settableClock(start: number): SettableClock {
  let now = start;
  const live = Clock.Clock.defaultValue();
  const clock = clockOf(() => now, () => BigInt(now) * 1_000_000n, (duration) => live.sleep(duration));
  return {
    layer: Layer.succeed(Clock.Clock, clock),
    set: (millis) => { now = millis; },
    advance: (millis) => { now += millis; },
    now: () => now,
  };
}

export interface SteppedClock {
  readonly clock: Clock.Clock;
  readonly layer: Layer.Layer<never>;
  /** @throws {never} */
  now(): number;
}

/** @throws {never} */
export function steppedClock(startNanos: bigint, stepped: (duration: Duration.Duration) => Effect.Effect<boolean>): SteppedClock {
  let nanos = startNanos;
  const millis = () => Number(nanos / 1_000_000n);
  const live = Clock.Clock.defaultValue();
  const advance = (duration: Duration.Duration) => Effect.sync(() => { nanos += Option.getOrElse(Duration.toNanos(duration), () => 0n); });
  const clock = clockOf(millis, () => nanos, (duration) => Effect.flatMap(stepped(duration), (step) => step ? advance(duration) : live.sleep(duration)));
  return { clock, layer: Layer.succeed(Clock.Clock, clock), now: millis };
}
