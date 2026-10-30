import { useEffect, useState } from "react";
import { isSolanaTransactionId } from "./lib/funding-address.mjs";
import { currentProjectSession } from "./lib/project-api";
import { useAction } from "./lib/use-action";

type Saved = {
  key: string;
  item: string | null;
  value: string;
  source: Record<string, unknown>;
};

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
  authorize: () => Promise<void>;
  verify: (hashes: string[]) => Promise<void>;
}) {
  const [actor, setActor] = useState<string | null>(null);
  const [rows, setRows] = useState<Saved[]>([]);
  const { busy, error, setError, run } = useAction();
  useEffect(() => {
    let active = true;
    void currentProjectSession()
      .then((session) => {
        if (!active || !session) return;
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
        if (active) {
          setActor(session.githubId);
          setRows(found);
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Saved transaction details could not be read. Use the case verification action.",
          );
      });
    return () => {
      active = false;
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
  const check = () =>
    void run(async () => {
      const session = await currentProjectSession();
      if (!actor || session?.githubId !== actor)
        throw new Error(
          "Your account changed. Reload before verifying payment.",
        );
      await authorize();
      for (const row of rows) {
        if (!valid(row.value.trim())) continue;
        const source = JSON.parse(
          sessionStorage.getItem(row.key) ?? "{}",
        ) as Record<string, unknown>;
        if (row.item === null) source.candidate = row.value.trim();
        else
          source[row.item] = {
            ...(source[row.item] as object),
            candidate: row.value.trim(),
          };
        sessionStorage.setItem(row.key, JSON.stringify(source));
      }
      await verify(hashes);
    });
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
