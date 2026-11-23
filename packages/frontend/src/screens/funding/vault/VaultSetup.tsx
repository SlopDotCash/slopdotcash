// spec/frontend/ownerVault.md, "Only a finalized matching result registers or counts, and failures keep the saved request"; spec/frontend/provisionalVault.md, "Reviewed identity and current chain evidence govern the form"; spec/frontend/provisionalVault.md, "Registration polling leaves an open wallet prompt and last verified form alone on unavailable reads"
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { Alert, Button, Disclosure, Field, Input, Label, Select, Spinner, Switch, WalletChooser, type WalletOption } from "@repo/ui";
import { Effect } from "effect";
import { useId, useState, useSyncExternalStore } from "react";
import { useMachine as useVault } from "../../../../gen/frontend__ownerVault.react.ts";
import { formatRewardCapDisplay, knownAssetSymbol, networkLabel } from "../../../kernels/assetText.ts";
import { transactionUrl } from "../../../kernels/explorers.ts";
import {
  checkRegistration,
  claimFor,
  clearUnreadableCreation,
  confirmCreationUnsent,
  connectSetupWallet,
  createVault,
  enterCreationHash,
  familyOfNetwork,
  includedMessage,
  loadSetup,
  ownerClaims,
  type Registration,
  registerExisting,
  reviewCreation,
  type ReviewedCreation,
  type SetupConnection,
  type SetupPurpose,
  type SetupRuntime,
  type SetupServices,
  savedCreation,
  setupMessages,
  setupRuntime,
  unreadableCreation,
  type WalletOffer,
  watchRegistration,
  watchSetupOffers,
} from "../../../wallets/owner/vaultSetup.vibe";
import { run, useSettled } from "./hooks.ts";
import { PendingCheck } from "./PendingCheck.tsx";
import type { FundingProject } from "./project.schema.ts";
import { NetworkName } from "./VaultActions.tsx";

export type CreationSummary = {
  readonly network: string;
  readonly owner: string;
  readonly asset: string;
  readonly capDisplay: string;
  readonly automatic: boolean;
  readonly networkFeeLamports?: string;
};

export type VaultSetupProps = {
  /** Which vault is set up: the project's rewards or its security bounty. */
  purpose: SetupPurpose;
  /** Where the setup options stand. */
  read: "loading" | "signIn" | "ready";
  /** The sign-in address that returns here. */
  loginHref: string;
  /** The networks a vault may be created on now. */
  networks: readonly string[];
  /** The chosen network. */
  network: string;
  /** The wallets the browser offers for the chosen network. */
  wallets: readonly WalletOption[];
  /** The connected wallet's address. */
  address?: string;
  /** The connected wallet is confirmed in the account for this network. */
  claimed: boolean;
  /** Exactly one confirmed wallet could recover an existing vault without reconnecting. */
  recoverable: boolean;
  /** The automatic monthly payment chosen for the new vault. */
  automatic: boolean;
  /** The project's monthly cap as it reads. */
  capDisplay: string;
  /** The reviewed creation, or the saved one while it waits. */
  summary?: CreationSummary;
  /** The reviewed vault already exists, so only its creation transaction is recovered. */
  existing?: boolean;
  /** A saved creation waits for registration, with its transaction when one is known. */
  pending?: { readonly hash: string; readonly unclear: boolean };
  /** The saved request cannot be read. */
  unreadable?: boolean;
  error?: string;
  notice?: string;
  busy?: boolean;
  onNetwork: (network: string) => void;
  onConnect: (wallet: WalletOption) => void;
  onChooseAnother: () => void;
  onAutomatic: (automatic: boolean) => void;
  onReview: () => void;
  onRecover: () => void;
  onCreate: () => void;
  onChangeReview: () => void;
  onRegisterExisting: (hash: string) => void;
  onCheck: () => void;
  onEnterHash: (hash: string) => void;
  onConfirmUnsent: () => void;
  onClearUnreadable: () => void;
  onReload: () => void;
};

function Summary({ purpose, summary }: { purpose: SetupPurpose; summary: CreationSummary }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Network</dt>
      <dd className="text-foreground">{networkLabel(summary.network)}</dd>
      <dt className="text-muted-foreground">Owner wallet</dt>
      <dd className="break-all font-mono text-foreground">{summary.owner}</dd>
      <dt className="text-muted-foreground">Reward token</dt>
      <dd className="break-all font-mono text-foreground">{summary.asset}</dd>
      {purpose === "security-bounty" ? (
        <>
          <dt className="text-muted-foreground">Payment policy</dt>
          <dd className="text-foreground">Security bounty: 75% researcher, 25% Slop</dd>
        </>
      ) : (
        <>
          <dt className="text-muted-foreground">Monthly cap</dt>
          <dd className="text-foreground">{summary.capDisplay}</dd>
          <dt className="text-muted-foreground">Automatic payment</dt>
          <dd className="text-foreground">{summary.automatic ? "On" : "Off"}</dd>
        </>
      )}
      {summary.networkFeeLamports === undefined ? null : (
        <>
          <dt className="text-muted-foreground">Estimated network fee</dt>
          <dd className="text-foreground">{formatBaseUnits({ value: BigInt(summary.networkFeeLamports), decimals: 9 })} SOL</dd>
        </>
      )}
    </dl>
  );
}

/** The owner's wallet creates and owns the vault: choose the network, connect a confirmed wallet, review, create, then the creation is registered once final. */
export function VaultSetup(props: VaultSetupProps) {
  const { purpose, read, loginHref, networks, network, wallets, address, claimed, recoverable, automatic, capDisplay, summary, existing = false, pending, unreadable = false, error, notice, busy = false } = props;
  const bounty = purpose === "security-bounty";
  const automaticId = useId();
  const [hash, setHash] = useState("");
  const solana = familyOfNetwork(network) === "solana";
  return (
    <section id="vault-setup" aria-label={bounty ? "Set up bounty vault" : "Set up project vault"} className="flex flex-col gap-4">
      <h3 className="text-lg font-semibold text-foreground">{bounty ? "Set up your bounty vault" : "Set up your vault"}</h3>
      <p className="text-sm text-muted-foreground">Your wallet creates and owns the vault.</p>
      {read === "signIn" ? (
        <p className="text-sm text-foreground">
          <a href={loginHref} className="text-primary underline-offset-4 hover:underline">
            Sign in with GitHub
          </a>{" "}
          to set up the vault.
        </p>
      ) : null}
      {read === "loading" && !error ? <Spinner label="Loading setup options…" /> : null}
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {notice ? <Alert variant="info">{notice}</Alert> : null}
      {unreadable ? (
        <Button variant="secondary" className="self-start" disabled={busy} onClick={props.onClearUnreadable}>
          I checked wallet activity; clear the unreadable saved request
        </Button>
      ) : null}
      {pending ? (
        <>
          {summary ? <Summary purpose={purpose} summary={summary} /> : null}
          <PendingCheck
            action="Vault creation"
            status="Pending · don't resend"
            hash={pending.hash}
            solana={solana}
            explorerUrl={transactionUrl(network, pending.hash || undefined)}
            canCheck
            busy={busy}
            onCheck={props.onCheck}
            onEnterHash={pending.hash === "" ? props.onEnterHash : undefined}
            onConfirmUnsent={pending.unclear ? props.onConfirmUnsent : undefined}
          />
        </>
      ) : summary ? (
        <>
          <Summary purpose={purpose} summary={summary} />
          {existing ? (
            <>
              <Field label={`Creation transaction ${solana ? "signature" : "hash"}`} className="max-w-160">
                <Input spellCheck={false} autoComplete="off" value={hash} disabled={busy} onChange={(event) => setHash(event.target.value)} />
              </Field>
              <Button className="self-start" disabled={busy || hash.trim() === ""} loading={busy} onClick={() => props.onRegisterExisting(hash)}>
                Check vault registration
              </Button>
            </>
          ) : (
            <Button className="self-start" loading={busy} onClick={props.onCreate}>
              Create vault in wallet
            </Button>
          )}
          <Button variant="secondary" className="self-start" disabled={busy} onClick={props.onChangeReview}>
            Change review
          </Button>
        </>
      ) : read === "ready" ? (
        networks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Vault creation is not available on this network yet.</p>
        ) : (
          <>
            {networks.length === 1 ? (
              <NetworkName network={network} />
            ) : (
              <Field label="Network" className="max-w-80">
                <Select value={network} disabled={busy} onChange={(event) => props.onNetwork(event.target.value)}>
                  {networks.map((choice) => (
                    <option key={choice} value={choice}>
                      {networkLabel(choice)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <WalletChooser
              legend="Connect your confirmed owner wallet"
              family={solana ? "solana" : "evm"}
              address={address}
              wallets={wallets}
              disabled={busy || unreadable}
              empty={<p className="text-sm text-muted-foreground">Open this page in your wallet app or install a compatible wallet.</p>}
              onConnect={props.onConnect}
            />
            {address ? (
              <Button variant="ghost" className="self-start" disabled={busy} onClick={props.onChooseAnother}>
                Choose another wallet
              </Button>
            ) : null}
            {address && !claimed ? (
              <p className="text-sm text-foreground">
                <a href="/account#wallets" className="text-primary underline-offset-4 hover:underline">
                  Confirm this wallet in your account
                </a>
                , then reload the setup options.
              </p>
            ) : null}
            {bounty ? null : (
              <>
                <div className="flex items-center gap-3">
                  <Switch id={automaticId} checked={automatic} disabled={busy} onCheckedChange={props.onAutomatic} />
                  <Label htmlFor={automaticId}>Automatic monthly payment</Label>
                </div>
                <p className="text-sm text-muted-foreground">Monthly cap: {capDisplay}. You can change this later.</p>
              </>
            )}
            <Button className="self-start" disabled={busy || !claimed || unreadable} loading={busy} onClick={props.onReview}>
              Review vault creation
            </Button>
            {address ? null : (
              <Disclosure summary="Recover an existing vault">
                {recoverable ? (
                  <div className="flex flex-col gap-2">
                    <p>
                      Recover without reconnecting your confirmed wallet.
                      {bounty ? null : " Use the automatic monthly payment setting selected at creation."}
                    </p>
                    <Button variant="secondary" className="self-start" disabled={busy || unreadable} onClick={props.onRecover}>
                      Recover existing vault
                    </Button>
                  </div>
                ) : (
                  <p>
                    <a href="/account#wallets" className="text-primary underline-offset-4 hover:underline">
                      Confirm a wallet
                    </a>{" "}
                    for this network, then reload the setup options.
                  </p>
                )}
              </Disclosure>
            )}
          </>
        )
      ) : null}
      {pending ? null : (
        <Button variant="secondary" className="self-start" disabled={busy} onClick={props.onReload}>
          Reload setup options
        </Button>
      )}
    </section>
  );
}

interface Offers {
  seen: ReadonlyArray<WalletOffer>;
  readonly subscribe: (notify: () => void) => () => void;
}

const offerStores = new WeakMap<SetupRuntime, Offers>();

function useSetupOffers(runtime: SetupRuntime): ReadonlyArray<WalletOffer> {
  const store =
    offerStores.get(runtime) ??
    (() => {
      const listeners = new Set<() => void>();
      let stop: (() => void) | undefined;
      const made: Offers = {
        seen: [],
        subscribe: (notify) => {
          listeners.add(notify);
          if (!stop) {
            const fiber = runtime.runFork(
              watchSetupOffers((offers) =>
                Effect.sync(() => {
                  made.seen = offers;
                  for (const listener of listeners) listener();
                }),
              ),
            );
            stop = () => fiber.interruptUnsafe();
          }
          return () => {
            listeners.delete(notify);
            if (listeners.size === 0) {
              stop?.();
              stop = undefined;
            }
          };
        },
      };
      offerStores.set(runtime, made);
      return made;
    })();
  return useSyncExternalStore(store.subscribe, () => store.seen, () => store.seen);
}

const live = new Set(["Awaiting", "Sent", "Unclear"]);

export type OwnerVaultSetupProps = {
  /** The project whose vault is set up. */
  project: FundingProject;
  /** The rewards vault, or the security bounty's own. */
  purpose?: SetupPurpose;
  /** The signed-in account's GitHub id as a number. */
  account: number;
  /** The signed-in account's GitHub id. */
  githubId: string;
  /** The sign-in address that returns here. */
  loginHref: string;
  /** Called once the vault is registered, with the server's notice, so the project is read again. */
  onRegistered: (notice: string | undefined) => void;
};

/** Vault setup for the project's current maintainer, from the saved creation when one waits. */
export function OwnerVaultSetup({ project, purpose = "ordinary", account, githubId, loginHref, onRegistered }: OwnerVaultSetupProps) {
  const reward = project.reward;
  const runtime = setupRuntime({ projectId: project.id, purpose, rewardAsset: reward.asset?.address, rewardDecimals: reward.asset?.decimals, monthlyCapMinor: reward.monthlyCapMinor ?? "0", monthlyCapDisplay: reward.monthlyCapDisplay ?? "" });
  const vault = useVault(runtime);
  const offers = useSetupOffers(runtime);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [chosen, setChosen] = useState<string>();
  const [automatic, setAutomatic] = useState(true);
  const [wallet, setWallet] = useState<SetupConnection>();
  const [review, setReview] = useState<ReviewedCreation>();
  const [provisional, setProvisional] = useState(false);
  const [cleared, setCleared] = useState(0);
  const load = useSettled(runtime, `setup:${account}:${reload}`, () => loadSetup(account, githubId));
  const unreadable = useSettled(runtime, `unreadable-creation:${cleared}`, () => unreadableCreation());
  const flow = vault.state?.creation;
  const saved = useSettled(runtime, `saved-creation:${flow?.slot.identity ?? ""}`, () => savedCreation());
  const act = async <A, E>(work: Effect.Effect<A, E, SetupServices>, then?: (value: A) => void) => {
    setBusy(true);
    setError("");
    setNotice("");
    const done = await run(runtime, work);
    setBusy(false);
    if (done.ok) then?.(done.value);
    else setError(done.message);
  };
  const registration = (shown: Registration | undefined, ownerAsked: boolean, network: string) => {
    if (shown === undefined) return;
    if (shown.kind === "registered") {
      setReview(undefined);
      onRegistered(shown.notice);
      return;
    }
    const included = shown.provisional !== undefined;
    if (provisional && !included) setNotice(setupMessages.dropped);
    else if (included && (!provisional || ownerAsked)) setNotice(includedMessage(networkLabel(network)));
    else if (ownerAsked) setNotice(setupMessages.notFinal);
    setProvisional(included);
  };
  const pending = flow !== undefined && live.has(flow.phase) && flow.slotOwner === account;
  const plan = saved.status === "done" ? saved.value : undefined;
  const hash = flow === undefined ? "" : flow.slot.hash || flow.slot.candidate;
  const watchKey = pending && flow?.phase === "Sent" && flow.slot.hash !== "" && !busy ? `watch:${flow.slot.identity}:${flow.slot.hash}` : "watch:idle";
  useSettled(runtime, watchKey, () =>
    watchKey === "watch:idle" ? Effect.void : watchRegistration(true, (shown) => Effect.sync(() => registration(shown, false, plan?.network ?? ""))).pipe(Effect.tap((done) => Effect.sync(() => registration(done.registration, false, plan?.network ?? "")))),
  );
  const options = load.status === "done" && load.value.kind === "ready" ? load.value.options : undefined;
  const network = plan?.network ?? chosen ?? options?.networks[0] ?? "";
  const family = familyOfNetwork(network);
  const claim = options !== undefined && wallet !== undefined ? claimFor(options, network, wallet.address) : undefined;
  const confirmed = options === undefined ? [] : ownerClaims(options, network);
  const shownReview = review?.review;
  const summary = pending
    ? plan && { network: plan.network, owner: plan.owner, asset: plan.asset, capDisplay: plan.capDisplay, automatic: plan.automatic }
    : shownReview && {
        network: shownReview.network,
        owner: shownReview.owner,
        asset: knownAssetSymbol({ network: shownReview.network, assetAddress: shownReview.asset, assetDecimals: shownReview.family === "solana" ? shownReview.decimals : (reward.asset?.decimals ?? 0) }) ?? shownReview.asset,
        capDisplay: shownReview.capDisplay,
        automatic: shownReview.automatic,
        networkFeeLamports: shownReview.family === "solana" && shownReview.transaction ? shownReview.transaction.networkFeeLamports : undefined,
      };
  const reset = () => {
    setWallet(undefined);
    setReview(undefined);
  };
  return (
    <VaultSetup
      purpose={purpose}
      read={load.status === "done" ? load.value.kind : "loading"}
      loginHref={loginHref}
      networks={options?.networks ?? []}
      network={network}
      wallets={offers.filter((offer) => offer.family === family).map((offer) => ({ id: String(offer.id), name: offer.name, icon: offer.icon }))}
      address={wallet?.address}
      claimed={claim !== undefined}
      recoverable={confirmed.length === 1}
      automatic={automatic}
      capDisplay={formatRewardCapDisplay(reward.monthlyCapDisplay ?? "")}
      summary={summary}
      existing={review !== undefined && review.review.existingVault !== null}
      pending={pending && flow ? { hash, unclear: flow.phase === "Unclear" } : undefined}
      unreadable={unreadable.status === "done" && unreadable.value}
      error={error || (load.status === "failed" ? load.message : "")}
      notice={notice}
      busy={busy}
      onNetwork={(next) => {
        setChosen(next);
        reset();
      }}
      onConnect={(offer) =>
        act(connectSetupWallet(Number(offer.id), network), (connection) => {
          setWallet(connection);
          setReview(undefined);
        })
      }
      onChooseAnother={() => setWallet(undefined)}
      onAutomatic={(next) => {
        setAutomatic(next);
        setReview(undefined);
      }}
      onReview={() => options && act(reviewCreation(options, network, automatic, wallet?.address), setReview)}
      onRecover={() => options && act(reviewCreation(options, network, automatic, undefined), setReview)}
      onCreate={() =>
        wallet &&
        review &&
        act(createVault(wallet, review), () => {
          setReview(undefined);
          setNotice(setupMessages.sent);
        })
      }
      onChangeReview={() => setReview(undefined)}
      onRegisterExisting={(candidate) => review && act(registerExisting(review, candidate), (shown) => registration(shown, true, review.input.network))}
      onCheck={() => act(checkRegistration(), (done) => registration(done.registration, true, network))}
      onEnterHash={(candidate) => act(enterCreationHash(candidate), (done) => registration(done.registration, true, network))}
      onConfirmUnsent={() =>
        act(confirmCreationUnsent(), () => {
          setReview(undefined);
          setNotice(setupMessages.cleared);
        })
      }
      onClearUnreadable={() => act(clearUnreadableCreation(), () => setCleared((count) => count + 1))}
      onReload={() => {
        reset();
        setReload((count) => count + 1);
      }}
    />
  );
}
