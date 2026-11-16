import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { errorMessage } from "./lib/errors";
import { isSolanaTransactionId } from "./lib/funding-address.mjs";
import { currentProjectSession } from "./lib/project-api";

type Saved = {
  key: string;
  item: string | null;
  value: string;
  source: Record<string, unknown>;
};

function savedRecord(row: Saved) {
  return row.item === null ? row.source : row.source[row.item];
}

/** Retains a verification path when a wallet change hides the old send request. */
export function BountySubmittedPayments({
  caseId,
  generation,
  solana,
  confirmed,
  authorize,
  verify,
}: {
  caseId: string;
  generation: number;
  solana: boolean;
  confirmed: string[];
  authorize: (isCurrent?: () => boolean) => Promise<void>;
  verify: (hashes: string[], isCurrent?: () => boolean) => Promise<void>;
}) {
  const [actor, setActor] = useState<string | null>(null);
  const [rows, setRows] = useState<Saved[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lifetime = useRef<symbol | null>(null);
  const active = useRef<symbol | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: context changes retire pending work during layout cleanup.
  useLayoutEffect(() => {
    lifetime.current = Symbol();
    active.current = null;
    setActor(null);
    setRows([]);
    setBusy(false);
    setError(null);
    return () => {
      lifetime.current = null;
      active.current = null;
    };
  }, [caseId, generation, solana]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: context changes retire pending work during layout cleanup.
  useEffect(() => {
    const owner = lifetime.current;
    let loading = true;
    const isCurrent = () => loading && owner === lifetime.current;
    void currentProjectSession()
      .then((session) => {
        if (!isCurrent() || !session) return;
        const prefix = solana
          ? `slop:bounty-solana:v1:${caseId}:${generation}:`
          : `slop:bounty-send:v1:${caseId}:${generation}:pay:`;
        const found: Saved[] = [];
        for (let index = 0; index < sessionStorage.length; index += 1) {
          const key = sessionStorage.key(index);
          if (!key?.startsWith(prefix) || !key.endsWith(`:${session.githubId}`))
            continue;
          const source = JSON.parse(
            sessionStorage.getItem(key) ?? "{}",
          ) as Record<string, unknown>;
          if (solana)
            found.push({
              key,
              item: null,
              source,
              value: String(source.candidate ?? source.signature ?? ""),
            });
          else
            for (const [item, entry] of Object.entries(source)) {
              const value = entry as { hash?: string; candidate?: string };
              found.push({
                key,
                item,
                source,
                value: value.candidate ?? value.hash ?? "",
              });
            }
        }
        if (isCurrent()) {
          setActor(session.githubId);
          setRows(found);
        }
      })
      .catch(() => {
        if (isCurrent())
          setError(
            "Saved transaction details could not be read. Use the case verification action.",
          );
      });
    return () => {
      loading = false;
    };
  }, [caseId, generation, setError, solana]);
  const valid = (value: string) =>
    solana ? isSolanaTransactionId(value) : /^0x[a-f0-9]{64}$/iu.test(value);
  const isConfirmed = (value: string) =>
    confirmed.some((hash) =>
      solana ? hash === value : hash.toLowerCase() === value.toLowerCase(),
    );
  const visible = rows.filter((row) => !isConfirmed(row.value.trim()));
  const hashes = visible.map((row) => row.value.trim()).filter(valid);
  if (!visible.length && !error) return null;
  const check = async () => {
    if (active.current !== null || lifetime.current === null) return;
    const owner = lifetime.current;
    const token = Symbol();
    active.current = token;
    const isCurrent = () =>
      active.current === token && lifetime.current === owner;
    setBusy(true);
    setError(null);
    try {
      const session = await currentProjectSession();
      if (!isCurrent()) return;
      if (!actor || session?.githubId !== actor)
        throw new Error(
          "Your account changed. Reload before verifying payment.",
        );
      await authorize(isCurrent);
      if (!isCurrent()) return;
      for (const row of rows) {
        if (!valid(row.value.trim())) continue;
        const raw = sessionStorage.getItem(row.key);
        const source: Record<string, unknown> | null =
          raw === null ? null : JSON.parse(raw);
        const expected = JSON.stringify(savedRecord(row));
        if (
          source === null ||
          JSON.stringify(row.item === null ? source : source[row.item]) !==
            expected
        )
          throw new Error(
            "The saved transaction changed. Reload before checking it again.",
          );
        const next =
          row.item === null
            ? { ...source, candidate: row.value.trim() }
            : {
                ...source,
                [row.item]: {
                  ...(source[row.item] as object),
                  candidate: row.value.trim(),
                },
              };
        sessionStorage.setItem(row.key, JSON.stringify(next));
        // A retry owns the bytes just saved, while edits made during the
        // request keep their current input value. Other nonce rows stay intact.
        setRows((current) =>
          current.map((entry) =>
            entry.key === row.key &&
            entry.item === row.item &&
            JSON.stringify(savedRecord(entry)) === expected
              ? { ...entry, source: next }
              : entry,
          ),
        );
      }
      await verify(hashes, isCurrent);
    } catch (caught) {
      if (isCurrent()) setError(errorMessage(caught));
    } finally {
      if (isCurrent()) {
        active.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <section
      className="direct-bounty-payment"
      aria-label="Submitted payment recovery"
    >
      <p>Verify transactions already sent before preparing another payment.</p>
      {visible.map((row, index) => (
        <label key={`${row.key}:${row.item}`}>
          Transaction {solana ? "signature" : "hash"} {index + 1}
          <input
            value={row.value}
            spellCheck={false}
            onChange={(event) =>
              setRows((current) =>
                current.map((entry) =>
                  entry.key === row.key && entry.item === row.item
                    ? { ...entry, value: event.target.value }
                    : entry,
                ),
              )
            }
          />
        </label>
      ))}
      <button
        className="button secondary-button"
        type="button"
        disabled={busy || hashes.length === 0}
        onClick={check}
      >
        Verify submitted payments
      </button>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
