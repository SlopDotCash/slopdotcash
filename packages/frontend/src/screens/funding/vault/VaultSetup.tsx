// spec/frontend/ownerVault.md, "Only a finalized matching result registers or counts, and failures keep the saved request"; spec/frontend/ownerVault.md, "A timer asks only for a wallet-returned hash the owner is not editing"; spec/frontend/provisionalVault.md, "Reviewed identity and current chain evidence govern the form"; spec/frontend/provisionalVault.md, "Registration polling leaves an open wallet prompt and last verified form alone on unavailable reads"; spec/frontend/provisionalVault.md, "Only the owner opens the provisional token deposit prompt, after storage saves its attempt"; spec/frontend/provisionalVault.md, "Included deposits are received pending finality only when there is an exact deposit event"
import { formatBaseUnits } from "@repo/settlement/kernels/amounts";
import { Address, Alert, Button, Card, CardTitle, Disclosure, Field, Input, Label, RadioGroup, Select, Spinner, Status, Switch, WalletChooser, type WalletOption } from "@repo/ui";
import { Effect } from "effect";
import { type ReactNode, useId, useRef, useState, useSyncExternalStore } from "react";
import { useMachine as useVault } from "../../../../gen/frontend__ownerVault.react.ts";
import { formatAssetAmount, formatRewardCapDisplay, knownAssetSymbol, networkLabel } from "../../../kernels/assetText.ts";
import { transactionUrl } from "../../../kernels/explorers.ts";
import { depositVerified, provisionalMessages, provisionalReceived, stepOf } from "../../../wallets/owner/provisionalVault.vibe";
import {
  askRegistrationSoon,
  checkProvisional,
  checkRegistration,
  claimFor,
  clearProvisionalUnsent,
  clearUnreadableCreation,
  confirmCreationUnsent,
  connectProvisionalOwner,
  connectSetupWallet,
  createVault,
  creationNotKept,
  depositProvisional,
  type EvmConnection,
  enterCreationHash,
  familyOfNetwork,
  includedMessage,
  loadSetup,
  openProvisional,
  ownerClaims,
  type ProvisionalChecked,
  type ProvisionalDeployment,
  provisionalDeploymentOf,
  type Registration,
  recoverProvisionalHash,
  registerExisting,
  reviewCreation,
  reviewProvisionalDeposit,
  type ReviewedCreation,
  type SetupConnection,
  type SetupPurpose,
  type SetupRuntime,
  type SetupServices,
  savedCreation,
  savedProvisional,
  setupEditing,
  setupMessages,
  setupRuntime,
  setupTabHidden,
  type TransferReview,
  unreadableCreation,
  type WalletOffer,
  watchProvisional,
  watchRegistration,
  watchSetupOffers,
} from "../../../wallets/owner/vaultSetup.vibe";
import { run, useSettled, useTabHidden } from "./hooks.ts";
import { pageHidden } from "./pageVisibility.ts";
import { PendingCheck } from "./PendingCheck.tsx";
import type { FundingProject } from "./project.schema.ts";
import { NetworkName, resetNote, signLabel } from "./VaultActions.tsx";

export type CreationSummary = {
  readonly network: string;
  readonly owner: string;
  readonly asset: string;
  readonly capDisplay: string;
  readonly automatic: boolean;
  readonly networkFeeLamports?: string;
};

export type VaultSetupProps = {
  purpose: SetupPurpose;
  read: "loading" | "signIn" | "ready";
  loginHref: string;
  networks: readonly string[];
  network: string;
  wallets: readonly WalletOption[];
  address?: string;
  claimed: boolean;
  recoverable: boolean;
  automatic: boolean;
  capDisplay: string;
  summary?: CreationSummary;
  existing?: boolean;
  pending?: { readonly hash: string; readonly unclear: boolean };
  unreadable?: boolean;
  funding?: ReactNode;
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

export function VaultSetup(props: VaultSetupProps) {
  const { purpose, read, loginHref, networks, network, wallets, address, claimed, recoverable, automatic, capDisplay, summary, existing = false, pending, unreadable = false, funding, error, notice, busy = false } = props;
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
          {funding}
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

export type ProvisionalDepositProps = {
  deployment: ProvisionalDeployment;
  wallets: readonly WalletOption[];
  address?: string;
  amount: string;
  review?: TransferReview;
  pending?: { readonly action: string; readonly hash: string; readonly sent: boolean };
  error?: string;
  notice?: string;
  busy?: boolean;
  onConnect: (wallet: WalletOption) => void;
  onChooseAnother: () => void;
  onAmount: (amount: string) => void;
  onReview: () => void;
  onDeposit: () => void;
  onCheck: () => void;
  onEnterHash: (candidate: string) => void;
  onConfirmUnsent?: () => void;
};

export function ProvisionalDeposit({ deployment, wallets, address, amount, review, pending, error, notice, busy = false, onConnect, onChooseAnother, onAmount, onReview, onDeposit, onCheck, onEnterHash, onConfirmUnsent }: ProvisionalDepositProps) {
  const formatted = (value: bigint) => formatAssetAmount(value, { network: deployment.network, assetAddress: deployment.asset, assetDecimals: review?.decimals ?? 0 });
  const step = review === undefined ? "send" : stepOf(review);
  const rows: ReadonlyArray<readonly [string, string]> = review
    ? [
        ["Current free balance", formatted(review.freeBalance)],
        ["Amount", formatted(review.gross)],
        ["Fee", formatted(review.fee)],
        ["Added to free funds", formatted(review.net)],
      ]
    : [];
  return (
    <Card className="flex flex-col gap-4" aria-label={`Fund or withdraw · ${networkLabel(deployment.network)}`}>
      <CardTitle className="flex items-center gap-2">
        Fund or withdraw <NetworkName network={deployment.network} />
      </CardTitle>
      <Disclosure summary="Contract details" defaultOpen={pending !== undefined || review !== undefined}>
        <div className="flex flex-col gap-2">
          <Address value={deployment.vault} label="Vault" />
          <Address value={deployment.asset} label="Token" />
        </div>
      </Disclosure>
      <Status presentation={{ tone: "Caution", icon: "Alert", label: "Direct transfers are not credited" }} />
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      {notice ? <Alert variant="info">{notice}</Alert> : null}
      <WalletChooser legend={pending ? "Reconnect to check this transaction" : "Choose a wallet"} family="evm" address={address} disabled={busy} wallets={wallets} onConnect={onConnect} />
      {pending ? (
        <PendingCheck
          action={pending.action}
          hash={pending.hash}
          explorerUrl={transactionUrl(deployment.network, pending.hash || undefined)}
          canCheck={address !== undefined}
          busy={busy}
          onCheck={onCheck}
          onEnterHash={pending.sent ? undefined : onEnterHash}
          onConfirmUnsent={!pending.sent && pending.hash === "" ? onConfirmUnsent : undefined}
        />
      ) : address ? (
        <>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              onReview();
            }}
          >
            <RadioGroup legend="Action" value="deposit" disabled={busy} options={[{ value: "deposit", label: "Deposit tokens" }]} />
            <Field label="Token amount">
              <Input inputMode="decimal" value={amount} disabled={busy} onChange={(event) => onAmount(event.target.value)} />
            </Field>
            <Button type="submit" variant="secondary" loading={busy} disabled={amount.trim() === ""}>
              Review deposit
            </Button>
          </form>
          {review ? (
            <section aria-label="Review vault action" className="flex flex-col gap-3">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {rows.map(([term, value]) => (
                  <div key={term} className="contents">
                    <dt className="text-muted-foreground">{term}</dt>
                    <dd className="text-foreground tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-sm text-foreground">This deposit joins the project's free funds. Only the vault owner can award them, or withdraw them less a 2% withdrawal fee to the refund destination below. Depositors have no refund right.</p>
              <Address value={deployment.owner} label="Refund destination" />
              {step === "reset" ? <p className="text-sm text-muted-foreground">{resetNote}</p> : null}
              <Button className="self-start" loading={busy} onClick={onDeposit}>
                {signLabel(step, "deposit")}
              </Button>
            </section>
          ) : null}
          <Button variant="ghost" className="self-start" disabled={busy} onClick={onChooseAnother}>
            Choose another wallet
          </Button>
        </>
      ) : null}
      {busy ? <Status presentation={{ tone: "Neutral", icon: "Spinner", label: "Waiting for wallet or chain response…" }} /> : null}
    </Card>
  );
}

type OwnerProvisionalDepositProps = {
  runtime: SetupRuntime;
  deployment: ProvisionalDeployment;
  offers: ReadonlyArray<WalletOffer>;
  connected?: EvmConnection;
  onBusy: (busy: boolean) => void;
  onFinalized: () => void;
};

function OwnerProvisionalDeposit({ runtime, deployment, offers, connected, onBusy, onFinalized }: OwnerProvisionalDepositProps) {
  const opened = useSettled(runtime, `provisional:${deployment.vault}:${deployment.deploymentTransaction}`, () => openProvisional(deployment));
  const [reads, setReads] = useState(0);
  const saved = useSettled(runtime, `provisional-saved:${deployment.vault}:${opened.status}:${reads}`, () => savedProvisional());
  const [wallet, setWallet] = useState<EvmConnection | undefined>(connected);
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<TransferReview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const network = networkLabel(deployment.network);
  const settle = (checked: ProvisionalChecked, connection = wallet) => {
    setReads((count) => count + 1);
    const view = checked.state.view;
    if (checked.approval && checked.state.approval === "ApprovalConfirmed") {
      setNotice(provisionalMessages.approved);
      if (connection === undefined || amount.trim() === "") return;
      void run(runtime, reviewProvisionalDeposit(connection, amount)).then((done) => {
        if (done.ok) setReview(done.value);
      });
      return;
    }
    if (view === "Received") setNotice(provisionalReceived(network, checked.hash));
    else if (view === "DepositVerified") {
      setNotice(depositVerified(checked.hash));
      onFinalized();
    } else if (view === "NoVault") setNotice(provisionalMessages.noVault);
    else if (view === "DepositFailed") setNotice(provisionalMessages.depositFailed);
    else if (view === "Waiting") setNotice(provisionalMessages.waiting);
  };
  const act = <A, E>(work: Effect.Effect<A, E, SetupServices>, then?: (value: A) => void): void => {
    if (busy) return;
    setBusy(true);
    onBusy(true);
    setError("");
    setNotice("");
    void run(runtime, work).then((done) => {
      setBusy(false);
      onBusy(false);
      setReads((count) => count + 1);
      if (done.ok) then?.(done.value);
      else setError(done.message);
    });
  };
  const plan = saved.status === "done" ? saved.value : undefined;
  const watchKey = wallet && plan?.sent && !busy ? `provisional-watch:${plan.action}:${plan.hash}` : "provisional-watch:idle";
  useSettled(runtime, watchKey, () => (watchKey === "provisional-watch:idle" || wallet === undefined ? Effect.void : Effect.asVoid(watchProvisional(wallet, pageHidden, (checked) => Effect.sync(() => settle(checked, wallet))))));
  return (
    <ProvisionalDeposit
      deployment={deployment}
      wallets={offers.filter((offer) => offer.family === "evm").map((offer) => ({ id: String(offer.id), name: offer.name, icon: offer.icon }))}
      address={wallet?.address}
      amount={amount}
      review={review}
      pending={plan}
      error={error || (opened.status === "failed" ? opened.message : "")}
      notice={notice}
      busy={busy}
      onConnect={(offer) =>
        act(connectProvisionalOwner(Number(offer.id)), (connection) => {
          setWallet(connection);
          setReview(undefined);
        })
      }
      onChooseAnother={() => {
        setWallet(undefined);
        setReview(undefined);
      }}
      onAmount={(next) => {
        setAmount(next);
        setReview(undefined);
      }}
      onReview={() => wallet && act(reviewProvisionalDeposit(wallet, amount), setReview)}
      onDeposit={() =>
        wallet &&
        act(depositProvisional(wallet, amount), () => {
          setReview(undefined);
          setNotice(provisionalMessages.waiting);
        })
      }
      onCheck={() => wallet && act(checkProvisional(wallet), (checked) => settle(checked, wallet))}
      onEnterHash={(candidate) => wallet && act(recoverProvisionalHash(wallet, candidate), (checked) => settle(checked, wallet))}
      onConfirmUnsent={wallet === undefined ? undefined : () => act(clearProvisionalUnsent(wallet), () => setNotice(setupMessages.cleared))}
    />
  );
}

const live = new Set(["Awaiting", "Sent", "Unclear"]);

export type OwnerVaultSetupProps = {
  project: FundingProject;
  purpose?: SetupPurpose;
  account: number;
  githubId: string;
  loginHref: string;
  onRegistered: (notice: string | undefined) => void;
};

export function OwnerVaultSetup({ project, purpose = "ordinary", account, githubId, loginHref, onRegistered }: OwnerVaultSetupProps) {
  const reward = project.reward;
  const runtime = setupRuntime({ projectId: project.id, purpose, rewardAsset: reward.asset?.address, rewardDecimals: reward.asset?.decimals, monthlyCapMinor: reward.monthlyCapMinor ?? "0", monthlyCapDisplay: reward.monthlyCapDisplay ?? "" });
  const vault = useVault(runtime);
  const offers = useSetupOffers(runtime);
  useTabHidden(runtime, setupTabHidden);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [chosen, setChosen] = useState<string>();
  const [automatic, setAutomatic] = useState(true);
  const [wallet, setWallet] = useState<SetupConnection>();
  const [review, setReview] = useState<ReviewedCreation>();
  const [provisional, setProvisional] = useState<ProvisionalDeployment>();
  const shownProvisionalRef = useRef<ProvisionalDeployment | undefined>(undefined);
  const fundingBusyRef = useRef(false);
  const [cleared, setCleared] = useState(0);
  const load = useSettled(runtime, `setup:${account}:${reload}`, () => loadSetup(account, githubId));
  const unreadable = useSettled(runtime, `unreadable-creation:${cleared}`, () => unreadableCreation());
  const flow = vault.state?.creation;
  const saved = useSettled(runtime, `saved-creation:${flow?.slot.identity ?? ""}`, () => savedCreation());
  const act = <A, E>(work: Effect.Effect<A, E, SetupServices>, then?: (value: A) => void): void => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    void run(runtime, work).then((done) => {
      setBusy(false);
      if (done.ok) then?.(done.value);
      else setError(done.message);
    });
  };
  const registration = (shown: Registration | undefined, ownerAsked: boolean, network: string) => {
    if (shown === undefined) return;
    if (shown.kind === "registered") {
      setReview(undefined);
      onRegistered(shown.notice);
      return;
    }
    const included = provisionalDeploymentOf(shown.provisional, plan, hash);
    const before = shownProvisionalRef.current;
    if (before && !included) setNotice(setupMessages.dropped);
    else if (included && (!before || ownerAsked)) setNotice(includedMessage(networkLabel(network)));
    else if (ownerAsked) setNotice(setupMessages.notFinal);
    shownProvisionalRef.current = included;
    setProvisional(included);
  };
  const pending = flow !== undefined && live.has(flow.phase) && flow.slotOwner === account;
  const plan = saved.status === "done" ? saved.value : undefined;
  const hash = flow === undefined ? "" : flow.slot.hash || flow.slot.candidate;
  const watchKey = pending && plan !== undefined && flow?.phase === "Sent" && flow.slot.hash !== "" && !busy ? `watch:${flow.slot.identity}:${flow.slot.hash}` : "watch:idle";
  useSettled(runtime, watchKey, () => (watchKey === "watch:idle" ? Effect.void : watchRegistration(true, (shown) => Effect.sync(() => registration(shown, false, plan?.network ?? "")))));
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
      funding={
        pending && hash !== "" && provisional && provisional.deploymentTransaction === hash.toLowerCase() ? (
          <OwnerProvisionalDeposit
            key={`${provisional.network}:${provisional.vault}`}
            runtime={runtime}
            deployment={provisional}
            offers={offers}
            connected={wallet?.family === "evm" && wallet.address.toLowerCase() === provisional.owner ? wallet.evm : undefined}
            onBusy={(running) => {
              fundingBusyRef.current = running;
              void run(runtime, setupEditing(running));
            }}
            onFinalized={() => void run(runtime, Effect.andThen(setupEditing(fundingBusyRef.current), askRegistrationSoon())).then((done) => done.ok && registration(done.value.registration, false, provisional.network))}
          />
        ) : null
      }
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
        act(createVault(wallet, review), (sent) => {
          setReview(undefined);
          setNotice(sent.kept === "saved" ? setupMessages.sent : creationNotKept(sent));
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
