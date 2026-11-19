// spec/contributor/discoverySnapshot.md, "A changed inventory retries the whole snapshot once and a failed read never publishes"
import type { Driver, Options } from "../../gen/contributor__discoverySnapshot.conformance.ts";
import type { Event, Snapshot } from "../../gen/contributor__discoverySnapshot.ts";
import { scriptRoot } from "../support/scripts/fixture.ts";

interface CommandBudget {
  readonly count: number;
  run(command: string, args: ReadonlyArray<string>): never;
}

interface LiveReport {
  readonly LiveInventoryChangedError: new () => Error;
  retryChangedLiveInventory<T>(collect: (attempt: { readonly attempt: number }) => T, onRetry: () => void, createCommandBudget: () => CommandBudget): T;
}

const live: LiveReport = await import(scriptRoot("snapshot-driver").url);

class Pending extends Error {}
class ReadFailed extends Error {}
class Unconsumed extends Error {}

const noCommands = (): CommandBudget => ({
  count: 0,
  run: () => {
    throw new Error("the snapshot driver reads through its planned events only");
  },
});

function replay(plan: ReadonlyArray<Event>): Snapshot | undefined {
  let consumed = 0;
  let observed: Snapshot = { phase: "ReadingInventory", attempt: 1, reads: 0, inventoryItems: -1, activityRead: false };
  const next = (): Event => {
    const event = plan[consumed];
    if (event === undefined) throw new Pending();
    consumed += 1;
    if (event.type === "failRead") throw new ReadFailed();
    return event;
  };
  try {
    live.retryChangedLiveInventory(({ attempt }) => {
      observed = { phase: "ReadingInventory", attempt, reads: 0, inventoryItems: -1, activityRead: false };
      const inventory = next();
      if (inventory.type !== "readInventory" || inventory.items < 0) throw new Unconsumed();
      observed = { ...observed, phase: "ReadingActivity", reads: 1, inventoryItems: inventory.items };
      const activity = next();
      if (activity.type !== "readActivity") throw new Unconsumed();
      observed = { ...observed, reads: 2 };
      if (activity.inventoryChanged) throw new live.LiveInventoryChangedError();
      observed = { ...observed, phase: "ReadyToPublish", activityRead: true };
      return inventory.items;
    }, () => {}, noCommands);
    const after = plan[consumed];
    if (after === undefined) return observed;
    consumed += 1;
    observed = { ...observed, phase: after.type === "publish" ? "Published" : after.type === "failRead" ? "SnapshotFailed" : observed.phase };
    if (observed.phase === "ReadyToPublish") return undefined;
  } catch (error) {
    if (error instanceof Unconsumed) return undefined;
    if (error instanceof Pending) return observed;
    if (error instanceof ReadFailed || error instanceof live.LiveInventoryChangedError) observed = { ...observed, phase: "SnapshotFailed" };
    else throw error;
  }
  return consumed === plan.length ? observed : undefined;
}

const plans = new Map<string, ReadonlyArray<Event>>();
const planOf = (key: string) => plans.get(key) ?? [];

export const driver: Driver = {
  reset: () => plans.clear(),
  dispatch: (key, event) => {
    const candidate = [...planOf(key), event];
    if (replay(candidate) === undefined) return "refused";
    plans.set(key, candidate);
    return "accepted";
  },
  observe: (key) => {
    const observed = replay(planOf(key));
    if (observed === undefined) throw new Error("an accepted plan no longer replays");
    return observed;
  },
};

export const options: Options = { keys: ["snapshot"] };
