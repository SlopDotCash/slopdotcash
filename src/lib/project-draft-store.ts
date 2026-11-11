import { useEffect, useState } from "react";

export type ProjectDraftStore = {
  initial: string | null;
  write(value: string | null): Promise<boolean>;
};

type RecordValue = { revision: string; value: string };
const opened = new Map<string, Promise<ProjectDraftStore>>();

function readRecord(key: string): RecordValue | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const value = JSON.parse(raw) as Partial<RecordValue> | null;
  if (
    !value ||
    typeof value.revision !== "string" ||
    !/^[1-9][0-9]*$/u.test(value.revision) ||
    typeof value.value !== "string"
  )
    throw new Error("Saved project draft is unreadable");
  return value as RecordValue;
}

function memoryOnly(initial: string | null): ProjectDraftStore {
  const store: ProjectDraftStore = {
    initial,
    write: async (value) => {
      store.initial = value;
      return false;
    },
  };
  return store;
}

/**
 * Each live document owns one slot. A duplicated tab copies the session
 * pointer, but cannot acquire the original document's exclusive slot lock.
 * Keep the lock for this document's lifetime, including SPA unmounts and
 * pending saves; browser termination releases it. Closed slots can be reused.
 */
async function openStore(
  key: string,
  legacyRead: () => string | null,
): Promise<ProjectDraftStore> {
  let legacy: string | null = null;
  try {
    legacy = legacyRead();
    if (!navigator.locks) return memoryOnly(legacy);
    const prefix = `slop:project-draft:v3:${encodeURIComponent(key)}:`;
    const pointer = `${prefix}tab`;
    const migrated = `${prefix}imported`;
    const slotPrefix = `${prefix}slot:`;
    const serialize = `${prefix}write`;
    const records = () => {
      const found: { key: string; record: RecordValue }[] = [];
      for (let index = 0; index < localStorage.length; index++) {
        const name = localStorage.key(index);
        if (!name?.startsWith(slotPrefix)) continue;
        const record = readRecord(name);
        if (record) found.push({ key: name, record });
      }
      return found;
    };
    const nextRevision = () =>
      (
        records().reduce(
          (latest, entry) =>
            BigInt(entry.record.revision) > latest
              ? BigInt(entry.record.revision)
              : latest,
          0n,
        ) + 1n
      ).toString();
    // Selection and all writes share this short lock. Logical revisions do
    // not depend on wall-clock order, and each slot is updated in place.
    return await navigator.locks.request(serialize, async () => {
      const saved = records().sort((a, b) => {
        const left = BigInt(a.record.revision);
        const right = BigInt(b.record.revision);
        return left === right
          ? a.key.localeCompare(b.key)
          : left > right
            ? -1
            : 1;
      });
      const selected = sessionStorage.getItem(pointer);
      const source =
        selected === "empty"
          ? null
          : selected === null
            ? (saved[0] ?? null)
            : (saved.find((entry) => entry.key === selected) ?? null);
      const initial =
        source?.record.value ??
        (selected === null && localStorage.getItem(migrated) !== "1"
          ? legacy
          : null);
      legacy = initial;
      const hold = (slot: string) =>
        new Promise<ProjectDraftStore | null>((resolve, reject) => {
          void navigator.locks
            .request(slot, { ifAvailable: true }, (lock) => {
              if (!lock) {
                resolve(null);
                return;
              }
              // Publish a fork before its pointer. This runs under the
              // project lock, so interruption cannot point at another tab's
              // record or lose a previously saved source during a reload.
              if (initial !== null && slot !== source?.key) {
                localStorage.setItem(
                  slot,
                  JSON.stringify({
                    revision: nextRevision(),
                    value: initial,
                  }),
                );
                localStorage.setItem(migrated, "1");
              }
              sessionStorage.setItem(pointer, slot);
              const store: ProjectDraftStore = {
                initial,
                write: async (value) => {
                  // SPA remounts can precede the queued storage task. Keep
                  // this document's latest value without waiting for I/O.
                  store.initial = value;
                  try {
                    await navigator.locks.request(serialize, () => {
                      if (value === null) localStorage.removeItem(slot);
                      else {
                        localStorage.setItem(
                          slot,
                          JSON.stringify({
                            revision: nextRevision(),
                            value,
                          }),
                        );
                      }
                      // Import is monotonic and follows a successful slot
                      // write. Never delete bytes an old app tab may own.
                      localStorage.setItem(migrated, "1");
                      sessionStorage.setItem(
                        pointer,
                        value === null ? "empty" : slot,
                      );
                    });
                    return true;
                  } catch {
                    return false;
                  }
                },
              };
              resolve(store);
              return new Promise<void>(() => {});
            })
            .catch(reject);
        });
      const resumed = source ? await hold(source.key) : null;
      return (
        resumed ??
        (await hold(`${slotPrefix}${crypto.randomUUID()}`)) ??
        memoryOnly(initial)
      );
    });
  } catch {
    return memoryOnly(legacy);
  }
}

/** Wait for ownership before a form can overwrite or remove saved bytes. */
export function useProjectDraftStore(
  key: string,
  legacyRead: () => string | null,
): ProjectDraftStore | null {
  const [snapshot, setSnapshot] = useState<{
    key: string;
    store: ProjectDraftStore;
  } | null>(null);
  // A logical key fixes its legacy format; callers do not change it in place.
  // biome-ignore lint/correctness/useExhaustiveDependencies: legacy format belongs to key.
  useEffect(() => {
    let active = true;
    setSnapshot(null);
    let pending = opened.get(key);
    if (!pending) {
      pending = openStore(key, legacyRead);
      opened.set(key, pending);
    }
    void pending.then((value) => {
      if (active) setSnapshot({ key, store: value });
    });
    return () => {
      active = false;
    };
  }, [key]);
  return snapshot?.key === key ? snapshot.store : null;
}

/** A changed payload is pending before effects run, including A → B → A. */
export function useProjectDraftSave(
  store: ProjectDraftStore,
  payload: string | null,
) {
  const [acknowledged, setAcknowledged] = useState({
    store,
    payload,
    completed: false,
    failed: false,
  });
  const current =
    acknowledged.store === store && acknowledged.payload === payload;
  // Reset this hook's own acknowledgement during render. An effect-only reset
  // would leave the previous Saved message visible for the new payload.
  if (!current) {
    setAcknowledged({ store, payload, completed: false, failed: false });
  }
  useEffect(() => {
    let active = true;
    void store.write(payload).then((saved) => {
      if (active)
        setAcknowledged({ store, payload, completed: true, failed: !saved });
    });
    return () => {
      active = false;
    };
  }, [store, payload]);
  return {
    saving: !current || !acknowledged.completed,
    failed: current && acknowledged.failed,
  };
}
