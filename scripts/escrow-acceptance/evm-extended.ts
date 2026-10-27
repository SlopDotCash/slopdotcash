/**
 * EVM leg of the extended #902 acceptance suite (Base Sepolia, Ethereum
 * Sepolia, Robinhood Chain Testnet). Each scenario uses its own vault from the
 * reviewed factory and the same role keys as section 21:
 *
 * - bounty: a 100-unit private bounty pays 75 and 25 with no other fee;
 * - monthly: the owner's monthly commitment switch and cap, the 72-hour
 *   cutoff window, a changed allocation, a manual award and payment before
 *   the automatic commitment, and the permissionless commitment through the
 *   production executor, with no double reservation or payment;
 * - walletless-lifecycle: no payment without a wallet, wrong-network and
 *   stale-version rejection, replacement, owner cancellation (refused while
 *   the deployed binding delay is zero; exercised on a review-window factory
 *   when one is configured) and recovery with immediate payment;
 * - interrupted-send, failed-recipient and frozen-fee-destination: payment
 *   through the production payments Worker cron and executor, with a lost
 *   broadcast answer, a blocked recipient and a blocked fee recipient.
 */
import { join } from "node:path";
import {
  decodeEventLog,
  encodeFunctionData,
  type Hex,
  keccak256,
  parseAbi,
} from "viem";
import { type PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";
import { handlePaymentsApi } from "../../backend/payments/handler";
import {
  buildBindCalldata,
  buildCancelBindingCalldata,
  buildClaimFeesCalldata,
  buildCommitAwardCalldata,
  buildCommitMonthlyCalldata,
  buildDepositCalldata,
  buildPayCalldata,
  buildWithdrawCalldata,
  evmAllocationRoot,
  evmAwardId,
  evmBindingTypedData,
  evmMonthlyDigest,
  evmVaultKey,
  type MonthlyAllocationEntry,
} from "../../contracts/evm/adapter";
import {
  buildCommitMonthlyLeafCalldata,
  buildReserveMonthlyCalldata,
  type EvmMonthlyReservation,
  evmMonthlyReserveDigest,
  evmMonthlySumTree,
  prepareEvmMonthlyReservation,
  readEvmMonthlyReserve,
} from "../../contracts/evm/monthly-reserve";
import { onRequest } from "../../functions/api/v1/[[path]]";
import type { EscrowDeployment } from "../../src/lib/escrow-policy.mjs";
import {
  monthlyFinalizationDate,
  PRD_MONTHLY_SCHEDULE,
  parseMonthlySchedule,
} from "../../src/lib/payments/monthly-allocation";
import { preflightEvmDeployment } from "../../workers/payment-executor/core";
import type { MonthlyAuthorization } from "../../workers/payment-executor/monthly";
import {
  type KeeperConfiguration,
  type KeeperResult,
  runKeeper,
} from "../payment-keeper/keeper";
import { openKeeperStore } from "../payment-keeper/store";
import {
  ERC20,
  evmDeploymentRecord,
  evmServices,
  FACTORY,
  openEvmRun,
  type Receipt,
  registerEvmWallet,
  signBinding,
  VAULT,
  ZERO,
} from "./evm";
import {
  type AcceptanceNetwork,
  type Evidence,
  evmKey,
  extendedAmounts,
  FaultRpc,
  isLoopbackRpc,
  openMonthlyPeriod,
  RpcError,
  requireEnv,
  runPaymentsCron,
  runScenarios,
  type ScenarioEvidence,
  scenarioActor,
  sha256Text,
  type TestActor,
  unitDivisor,
  untilReady,
  Waiting,
  waitPolicy,
} from "./shared";

const BLOCKABLE = parseAbi(["function blockAddress(address)"]);
const AWARDS = parseAbi([
  "function commitAward(bytes32,uint64,uint128,bytes32)",
  "function commitBountyAward(bytes32,uint64,uint128,bytes32)",
]);
type Award = { id: string; source: string; actor: TestActor } & ReturnType<
  ReturnType<typeof extendedAmounts>["award"]
>;
const text = (value: bigint) => value.toString();

export async function runEvmExtended(
  network: AcceptanceNetwork,
  directory: string,
): Promise<Evidence> {
  const ctx = await openEvmRun(network, directory, "extended");
  const { chain, keys, identity, run, persist, chainId } = ctx;
  const address = (value: string) => {
    const lower = value.trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(lower))
      throw new Error(`${value} is not an EVM address`);
    return lower;
  };
  const bountyAssets = requireEnv("ESCROW_ACCEPTANCE_ASSETS")
    .split(",")
    .map(address);
  const scenarioAsset = address(requireEnv("ESCROW_ACCEPTANCE_SCENARIO_ASSET"));
  const blockable = address(requireEnv("ESCROW_ACCEPTANCE_BLOCKABLE_ASSET"));
  const reviewFactory = process.env.ESCROW_ACCEPTANCE_REVIEW_FACTORY
    ? address(process.env.ESCROW_ACCEPTANCE_REVIEW_FACTORY)
    : null;
  const divisor = unitDivisor();
  const policyWait = waitPolicy();
  const deadline = Date.now() + policyWait.maxWaitMs;
  const report = (reason: string) =>
    console.log(`[${network}] waiting: ${reason}`);
  const ready = <T>(step: () => Promise<T>) =>
    untilReady(step, policyWait, deadline, report);
  // Destination wallets are derived in memory from the second actor key, so
  // each scenario has its own wallets and no new key is stored anywhere.
  const actorKey = evmKey("ESCROW_ACCEPTANCE_ACTOR_B_KEY");
  const wallet = (label: string) =>
    privateKeyToAccount(
      keccak256(
        `${actorKey}${Buffer.from(`slop-acceptance-wallet:${label}`).toString("hex")}`,
      ),
    );
  // The project-operated keeper's gas wallet. It must hold no vault or factory
  // role; where the relayer test key is also the upgrade authority, supply a
  // dedicated key.
  const keeperKey: PrivateKeyAccount = process.env.ESCROW_ACCEPTANCE_KEEPER_KEY
    ? privateKeyToAccount(evmKey("ESCROW_ACCEPTANCE_KEEPER_KEY"))
    : keys.relayer;
  const decimalsOf = async (asset: string) =>
    Number(await chain.read<number>(asset, ERC20, "decimals"));
  const amountsFor = async (asset: string) =>
    extendedAmounts(await decimalsOf(asset), divisor);
  const deviations = new Set(run.deviations);
  const deviate = (note: string) => {
    if (!deviations.has(note)) {
      deviations.add(note);
      run.deviations.push(note);
    }
  };
  const monthlySchedule =
    parseMonthlySchedule(process.env.ESCROW_ACCEPTANCE_MONTHLY_SCHEDULE) ??
    PRD_MONTHLY_SCHEDULE;
  if (monthlySchedule.firstPeriod !== PRD_MONTHLY_SCHEDULE.firstPeriod)
    deviate(
      `ESCROW_ACCEPTANCE_MONTHLY_SCHEDULE starts the keeper at ${monthlySchedule.firstPeriod}, before the PRD first period ${PRD_MONTHLY_SCHEDULE.firstPeriod}; the monthly result is prelaunch automation qualification, not the calendar observation.`,
    );
  if (divisor !== 1n)
    deviate(
      "ESCROW_ACCEPTANCE_UNIT_DIVISOR scaled the scenario figures down; amounts are not at full scale.",
    );
  if (ctx.bindingDelay !== 0n)
    throw new Error(
      "The extended suite expects the deployed zero binding delay on ESCROW_ACCEPTANCE_FACTORY",
    );

  // ---- shared steps -------------------------------------------------------
  const send = (
    entry: ScenarioEvidence,
    key: string,
    account: PrivateKeyAccount,
    to: string,
    data: Hex,
    options?: { gas?: bigint; expect?: "success" | "reverted" },
  ) => ready(() => chain.send(entry.steps, key, account, to, data, options));
  const log = (receipt: Receipt, vault: string, name: string) => {
    for (const item of receipt.logs) {
      if (item.address.toLowerCase() !== vault) continue;
      try {
        const event = decodeEventLog({
          abi: VAULT,
          topics: item.topics as [Hex, ...Hex[]],
          data: item.data,
        });
        if (event.eventName === name)
          return event.args as Record<string, unknown>;
      } catch {}
    }
    throw new Error(`${receipt.transactionHash}: no ${name} event`);
  };
  const at = (block: string | bigint, offset = 0n) =>
    `0x${(BigInt(block) + offset).toString(16)}`;
  /** Token movement of one address in one mined transaction's block. */
  const delta = async (asset: string, holder: string, receipt: Receipt) =>
    (await chain.balance(asset, holder, receipt.blockNumber)) -
    (await chain.balance(asset, holder, at(receipt.blockNumber, -1n)));
  /** eth_getLogs in windows, since public test network RPCs bound the block range. */
  const getLogs = async (
    filter: { address: string; topics: (string | null)[] },
    from: bigint,
  ) => {
    const latest = BigInt((await chain.rpc("eth_blockNumber", [])) as string);
    const found: { transactionHash: string; blockNumber: string }[] = [];
    for (let start = from; start <= latest; start += 2000n) {
      const end = start + 1999n < latest ? start + 1999n : latest;
      found.push(
        ...((await chain.rpc("eth_getLogs", [
          { ...filter, fromBlock: at(start), toBlock: at(end) },
        ])) as { transactionHash: string; blockNumber: string }[]),
      );
    }
    return found;
  };
  const blockTime = async (block: string) =>
    BigInt(
      (
        (await chain.rpc("eth_getBlockByNumber", [block, false])) as {
          timestamp: string;
        }
      ).timestamp,
    );
  const totals = async (vault: string) => {
    const t = await chain.read<readonly bigint[]>(vault, VAULT, "totals");
    const names = [
      "deposited",
      "paid",
      "payoutFees",
      "grossWithdrawn",
      "withdrawalFees",
      "free",
      "principalReserved",
      "feesReserved",
      "feesAccrued",
      "balance",
    ];
    return Object.fromEntries(names.map((name, i) => [name, text(t[i])]));
  };
  const expectEqual = (what: string, actual: unknown, expected: unknown) => {
    if (String(actual) !== String(expected))
      throw new Error(`${what}: ${actual}, expected ${expected}`);
  };
  /** The owner's own vault for one scenario, created once. */
  const vaultFor = async (
    entry: ScenarioEvidence,
    name: string,
    asset: string,
    options: { factory?: string; bounty?: boolean } = {},
  ) => {
    const factory = options.factory ?? ctx.factory;
    const projectId = `0x${sha256Text(`slop-escrow-acceptance:${run.runId}:${network}:${name}:${asset}`)}`;
    const payoutPolicy = options.bounty ? "security-bounty" : "ordinary";
    const key = evmVaultKey({
      owner: keys.owner.address,
      projectId,
      asset,
      payoutPolicy,
    });
    let vault = (
      await chain.read<string>(factory, FACTORY, "vaults", [key])
    ).toLowerCase();
    const creation = entry.steps[`${name}:create`];
    if (vault === ZERO || (creation && !creation.status)) {
      if (entry.steps[`${name}:create`]?.status === "success")
        throw new Error(`${name}: recorded vault is missing from the factory`);
      await send(
        entry,
        `${name}:create`,
        keys.owner,
        factory,
        encodeFunctionData({
          abi: FACTORY,
          functionName: "create",
          args: [projectId as Hex, asset as Hex, options.bounty ? 1 : 0],
        }),
      );
      vault = (
        await chain.read<string>(factory, FACTORY, "vaults", [key])
      ).toLowerCase();
    }
    if (!entry.steps[`${name}:create`]) {
      // An interrupted run can create the vault after its evidence was last
      // saved; the factory's VaultCreated event names the creation.
      const startedAtBlock = run.chain.startedAtBlock;
      if (!/^(0|[1-9][0-9]*)$/.test(startedAtBlock ?? ""))
        throw new Error(
          "Creation recovery has no recorded transaction or run start block. Preserve this evidence and use a new run.",
        );
      const [created] = await getLogs(
        {
          address: factory,
          topics: [
            keccak256(
              Buffer.from(
                "VaultCreated(bytes32,address,address,address,uint8,uint8)",
              ),
            ),
            projectId,
            null,
            `0x${vault.slice(2).padStart(64, "0")}`,
          ],
        },
        BigInt(startedAtBlock),
      );
      if (!created) throw new Error(`${name}: vault has no VaultCreated event`);
      entry.steps[`${name}:create`] = {
        transactionId: created.transactionHash,
        from: keys.owner.address.toLowerCase(),
        status: "success",
        block: text(BigInt(created.blockNumber)),
        note: "Recovered from the factory's VaultCreated event",
      };
      await persist();
    }
    entry.vaults[name] = vault;
    if (!entry.assets.includes(asset)) entry.assets.push(asset);
    return vault;
  };
  const fund = async (
    entry: ScenarioEvidence,
    name: string,
    vault: string,
    asset: string,
    amount: bigint,
  ) => {
    if (!entry.steps[`${name}:deposit`]) {
      const held = await chain.balance(asset, keys.owner.address);
      if (held < amount && !entry.steps[`${name}:approve`])
        throw new Error(
          `owner ${keys.owner.address} holds ${held} of ${asset}; ${name} needs ${amount} base units`,
        );
      await send(
        entry,
        `${name}:approve`,
        keys.owner,
        asset,
        encodeFunctionData({
          abi: ERC20,
          functionName: "approve",
          args: [vault as Hex, amount],
        }),
      );
    }
    const receipt = await send(
      entry,
      `${name}:deposit`,
      keys.owner,
      vault,
      buildDepositCalldata(amount) as Hex,
    );
    expectEqual(
      `${name} deposit`,
      log(receipt, vault, "Deposited").amount,
      amount,
    );
  };
  const award = (
    vault: string,
    label: string,
    actor: TestActor,
    figures: ReturnType<ReturnType<typeof extendedAmounts>["award"]>,
  ): Award => {
    const source = `0x${sha256Text(`${vault}:${label}`)}`;
    return {
      id: evmAwardId(BigInt(chainId), vault, source),
      source,
      actor,
      ...figures,
    };
  };
  const commit = async (
    entry: ScenarioEvidence,
    key: string,
    vault: string,
    item: Award,
    bounty = false,
  ) => {
    if (!entry.steps[key]) {
      // An interrupted run can commit after its evidence was last saved; the
      // vault's AwardCommitted event names that transaction.
      const [created] = await getLogs(
        {
          address: vault,
          topics: [
            keccak256(
              Buffer.from(
                "AwardCommitted(bytes32,uint64,uint128,uint128,bytes32)",
              ),
            ),
            item.id,
          ],
        },
        BigInt(entry.steps[`${key.split(":")[0]}:create`]?.block ?? "0"),
      );
      if (created) {
        entry.steps[key] = {
          transactionId: created.transactionHash,
          from: keys.owner.address.toLowerCase(),
          block: text(BigInt(created.blockNumber)),
          note: "Recovered from the vault's AwardCommitted event",
        };
        await persist();
      }
    }
    const receipt = await send(
      entry,
      key,
      keys.owner,
      vault,
      encodeFunctionData({
        abi: AWARDS,
        functionName: bounty ? "commitBountyAward" : "commitAward",
        args: [
          item.id as Hex,
          BigInt(item.actor.githubUserId),
          item.gross,
          item.source as Hex,
        ],
      }),
    );
    const event = log(receipt, vault, "AwardCommitted");
    expectEqual(`${key} gross`, event.gross, item.gross);
    expectEqual(`${key} fee`, event.fee, item.fee);
    return receipt;
  };
  /** The identity authority's binding call with the wallet's EIP-712 acceptance. */
  const bindingCall = async (
    vault: string,
    actor: TestActor,
    destination: PrivateKeyAccount,
    expectedVersion: bigint,
    domain: { chainId?: bigint; vault?: string } = {},
  ) => {
    const input = {
      githubUserId: actor.githubUserId,
      destination: destination.address.toLowerCase(),
      expectedVersion: text(expectedVersion),
      claimDigest: `0x${sha256Text(`${vault}:${actor.githubUserId}:${destination.address}`)}`,
      expiresAt: text((await chain.latestTime()) + 3600n),
    };
    const typedData = evmBindingTypedData(
      domain.chainId ?? BigInt(chainId),
      domain.vault ?? vault,
      input,
    );
    return buildBindCalldata({
      ...input,
      walletSignature: await signBinding(destination, typedData),
    }) as Hex;
  };
  const bind = async (
    entry: ScenarioEvidence,
    key: string,
    vault: string,
    actor: TestActor,
    destination: PrivateKeyAccount,
    expectedVersion: bigint,
    authority: PrivateKeyAccount = identity,
  ) => {
    const receipt = await send(
      entry,
      key,
      authority,
      vault,
      entry.steps[key]
        ? "0x"
        : await bindingCall(vault, actor, destination, expectedVersion),
    );
    const event = log(receipt, vault, "DestinationBound");
    expectEqual(`${key} version`, event.version, expectedVersion + 1n);
    expectEqual(
      `${key} destination`,
      String(event.destination).toLowerCase(),
      destination.address.toLowerCase(),
    );
    return receipt;
  };
  const pay = async (
    entry: ScenarioEvidence,
    key: string,
    vault: string,
    asset: string,
    item: Award,
    version: bigint,
    destination: string,
  ) => {
    const receipt = await send(
      entry,
      key,
      keys.relayer,
      vault,
      buildPayCalldata(item.id, text(version)) as Hex,
    );
    const event = log(receipt, vault, "Paid");
    expectEqual(`${key} net`, event.net, item.net);
    expectEqual(`${key} fee`, event.fee, item.fee);
    expectEqual(
      `${key} destination`,
      String(event.destination).toLowerCase(),
      destination.toLowerCase(),
    );
    expectEqual(
      `${key} destination delta`,
      await delta(asset, destination, receipt),
      item.net,
    );
    return receipt;
  };
  const refuse = async (from: string, to: string, data: string) =>
    chain.mustRevert(from, to, data);
  const expectRefusal = async (
    entry: ScenarioEvidence,
    key: string,
    expected: string,
    from: string,
    to: string,
    data: string,
  ) => {
    if (entry.checks[key]) return;
    const revert = await refuse(from, to, data);
    if (revert !== expected)
      throw new Error(`${key}: reverted with ${revert}, expected ${expected}`);
    entry.checks[key] = { revert };
    await persist();
  };
  const claim = async (
    entry: ScenarioEvidence,
    key: string,
    vault: string,
    asset: string,
    expected: bigint,
  ) => {
    const receipt = await send(
      entry,
      key,
      keys.depositor,
      vault,
      buildClaimFeesCalldata() as Hex,
    );
    const event = log(receipt, vault, "FeesClaimed");
    expectEqual(`${key} amount`, event.amount, expected);
    expectEqual(
      `${key} fee recipient delta`,
      await delta(asset, ctx.feeRecipient, receipt),
      expected,
    );
    return receipt;
  };

  /** The monthly reserve version of the vault logic the factory creates now; 1 without V2. */
  const reserveVersion = async () => {
    const implementation = await chain.read<string>(
      ctx.factory,
      FACTORY,
      "vaultImplementation",
    );
    try {
      return Number(
        await chain.read<number>(
          implementation,
          VAULT,
          "monthlyReserveVersion",
        ),
      );
    } catch (error) {
      if (error instanceof RpcError && error.reverted && error.data === "0x")
        return 1;
      throw error;
    }
  };
  /**
   * One bounded run of the project-operated keeper (scripts/payment-keeper)
   * with the relayer key as its dedicated gas signer. The keeper reads the
   * unchanged public registry and payment routes through an in-process
   * transport to this run's registry and payments databases; every other
   * request, including each RPC call, goes to the network unchanged.
   */
  const keeperRunner = (
    services: ReturnType<typeof evmServices>,
    projectId: string,
    file: string,
  ) => {
    const origin = "https://keeper.acceptance.invalid";
    const gasCeiling = BigInt(
      (ctx.policy as { gasCeiling?: string }).gasCeiling ?? "0",
    );
    const additionalFeeReserve =
      process.env.ESCROW_ACCEPTANCE_KEEPER_ADDITIONAL_FEE_RESERVE ??
      (ctx.policy.chain === "base" && !isLoopbackRpc(ctx.rpcUrl) ? "" : "0");
    if (!/^(0|[1-9][0-9]*)$/.test(additionalFeeReserve))
      throw new Error(
        "ESCROW_ACCEPTANCE_KEEPER_ADDITIONAL_FEE_RESERVE (wei) is required on Base Sepolia for the keeper's L1 and operator fee reserve",
      );
    // The executor's reviewed gas ceiling at its 10-gwei fee ceiling.
    const perTransaction =
      gasCeiling * 10_000_000_000n + BigInt(additionalFeeReserve);
    const configuration: KeeperConfiguration = {
      apiOrigin: origin,
      network: network as KeeperConfiguration["network"],
      projectIds: [projectId],
      signer: keeperKey.address,
      rpcUrl: ctx.rpcUrl,
      perRun: 16,
      monthlySchedule,
      gas: {
        perTransaction: text(perTransaction),
        perDay: text(perTransaction * 40n),
        additionalFeeReserve,
      },
    };
    let signatures = 0;
    const signer = {
      address: keeperKey.address,
      async signTransaction(
        input: Parameters<typeof keeperKey.signTransaction>[0],
      ) {
        signatures += 1;
        return keeperKey.signTransaction(input);
      },
    };
    const route = (real: typeof fetch) =>
      (async (input: Request | string | URL, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input),
        );
        if (url.origin !== origin) return real(input, init);
        const request = new Request(
          `https://slop.cash${url.pathname}${url.search}`,
        );
        return url.pathname.startsWith("/api/v1/payments/")
          ? handlePaymentsApi(request, { db: services.projection.db })
          : onRequest({
              request,
              env: {
                SLOP_DB: services.registry.db,
                PAYMENT_NETWORKS: JSON.stringify([network]),
              },
            } as never);
      }) as typeof fetch;
    const open = <T>(
      use: (store: ReturnType<typeof openKeeperStore>) => Promise<T>,
    ) =>
      (async () => {
        const store = openKeeperStore(file);
        try {
          return await use(store);
        } finally {
          store.close();
        }
      })();
    return {
      signatures: () => signatures,
      journal: <T>(key: string) => open((store) => store.journal.get<T>(key)),
      tick: () =>
        open(async (store) => {
          const real = globalThis.fetch;
          globalThis.fetch = route(real);
          try {
            return await runKeeper(
              configuration,
              {
                store,
                evmSigner: signer,
                // Chain time: on a public test network it equals the wall clock;
                // a local fork moves it forward to the commitment window.
                now: new Date(Number(await chain.latestTime()) * 1000),
                ...(isLoopbackRpc(ctx.rpcUrl) ? { localChain: {} } : {}),
              },
              true,
            );
          } finally {
            globalThis.fetch = real;
          }
        }),
    };
  };

  // ---- 1. private bounty ---------------------------------------------------
  async function bounty(entry: ScenarioEvidence) {
    for (const [index, asset] of bountyAssets.entries()) {
      const name = `bounty-${index}`;
      const amounts = await amountsFor(asset);
      const vault = await vaultFor(entry, name, asset, { bounty: true });
      expectEqual(
        `${name} purpose`,
        await chain.read<number>(vault, VAULT, "purpose"),
        1,
      );
      await fund(entry, name, vault, asset, amounts.bounty.deposit);
      const actor = scenarioActor(0, index);
      const item: Award = {
        ...award(vault, "bounty", actor, amounts.award(100n)),
        fee: amounts.bounty.fee,
        net: amounts.bounty.researcher,
      };
      // An ordinary award and an inexact split are refused in a bounty vault.
      await expectRefusal(
        entry,
        `${name}:ordinary-award-refused`,
        "WrongPurpose",
        keys.owner.address,
        vault,
        buildCommitAwardCalldata({
          obligationId: item.id,
          githubUserId: actor.githubUserId,
          grossMicro: item.gross,
          sourceDigest: item.source,
        }),
      );
      await expectRefusal(
        entry,
        `${name}:inexact-split-refused`,
        "InvalidInput",
        keys.owner.address,
        vault,
        encodeFunctionData({
          abi: AWARDS,
          functionName: "commitBountyAward",
          args: [
            item.id as Hex,
            BigInt(actor.githubUserId),
            item.gross - 2n,
            item.source as Hex,
          ],
        }),
      );
      await commit(entry, `${name}:commit`, vault, item, true);
      const researcher = wallet(`${name}:researcher`);
      await bind(entry, `${name}:bind`, vault, actor, researcher, 0n);
      const paid = await pay(
        entry,
        `${name}:pay`,
        vault,
        asset,
        item,
        1n,
        researcher.address,
      );
      const claimed = await claim(
        entry,
        `${name}:claim-fees`,
        vault,
        asset,
        amounts.bounty.fee,
      );
      const after = await totals(vault);
      expectEqual(`${name} paid`, after.paid, amounts.bounty.researcher);
      expectEqual(`${name} fees`, after.payoutFees, amounts.bounty.fee);
      for (const field of [
        "free",
        "principalReserved",
        "feesReserved",
        "feesAccrued",
        "balance",
        "grossWithdrawn",
        "withdrawalFees",
      ])
        expectEqual(`${name} ${field}`, after[field], 0);
      await expectRefusal(
        entry,
        `${name}:nothing-left-to-withdraw`,
        "InsufficientFreeBalance",
        keys.owner.address,
        vault,
        buildWithdrawCalldata(1n),
      );
      entry.checks[name] = {
        asset,
        decimals: await decimalsOf(asset),
        gross: text(item.gross),
        researcherReceived: text(await delta(asset, researcher.address, paid)),
        slopFeeClaimed: text(amounts.bounty.fee),
        feeRecipient: ctx.feeRecipient,
        feeClaimTransaction: claimed.transactionHash,
        researcher: researcher.address.toLowerCase(),
        totals: after,
      };
      await persist();
    }
  }

  // ---- 2. monthly commitment -----------------------------------------------
  async function monthly(entry: ScenarioEvidence) {
    // A factory whose vault logic has the V2 monthly reserve runs the month
    // through the project-operated keeper (reserveMonthly, then
    // commitMonthlyLeaf). An earlier factory keeps the legacy executor path.
    entry.checks.monthlyPath ??=
      (await reserveVersion()) === 2 ? "keeper-v2" : "executor-v1";
    const keeperPath = entry.checks.monthlyPath === "keeper-v2";
    if (keeperPath && !entry.checks.periods) {
      // The keeper serves its configured schedule only, from its first period.
      const first = monthlySchedule.firstPeriod;
      if (openMonthlyPeriod(await chain.latestTime()).open < first) {
        const opens = monthlyFinalizationDate(monthlySchedule, first);
        throw new Waiting(
          `The project-operated keeper admits PRD periods from ${first}. That commitment window opens at ${opens?.toISOString()} chain time. No monthly transaction was sent.`,
          opens,
        );
      }
    }
    const asset = scenarioAsset;
    const amounts = await amountsFor(asset);
    const vault = await vaultFor(entry, "monthly", asset);
    const monthlyProjectId = `acceptance-${run.runId.slice(0, 8)}-monthly`;
    const monthlyProject = () => ({
      projectId: monthlyProjectId,
      effectiveCycle: run.startedAt.slice(0, 7),
      deployment: entry.checks.deployment as EscrowDeployment,
      // The keeper admits a month only for an active registry project.
      status: keeperPath ? ("active" as const) : ("paused" as const),
    });
    const services = evmServices(ctx, join(directory, "monthly"), () => [
      monthlyProject(),
    ]);
    if (!entry.checks.deployment) {
      entry.checks.deployment = await evmDeploymentRecord(
        ctx,
        vault,
        asset,
        entry.steps["monthly:create"].transactionId,
      );
      await persist();
    }
    services.refresh();
    await fund(entry, "monthly", vault, asset, 500n * amounts.unit);
    const cap = 300n * amounts.unit;
    const actors = [0, 1, 2].map((n) => scenarioActor(1, n));
    const items = [
      award(vault, "monthly-x", actors[0], amounts.award(100n)),
      award(vault, "monthly-y", actors[1], amounts.award(100n)),
      award(vault, "monthly-z", actors[2], amounts.award(50n)),
    ];
    const entries = (list: Award[]): MonthlyAllocationEntry[] =>
      list.map((item) => ({
        githubUserId: item.actor.githubUserId,
        grossMicro: item.gross,
        sourceDigest: item.source,
      }));
    const periods =
      (entry.checks.periods as ReturnType<typeof openMonthlyPeriod>) ??
      openMonthlyPeriod(await chain.latestTime());
    entry.checks.periods = periods;
    const digest = (period: string, list: MonthlyAllocationEntry[]) =>
      evmMonthlyDigest(BigInt(chainId), vault, period, evmAllocationRoot(list));
    const attest = async (period: string, list: MonthlyAllocationEntry[]) =>
      identity.sign({ hash: digest(period, list) as Hex });
    const commitData = async (
      period: string,
      list: MonthlyAllocationEntry[],
      signedList = list,
    ) =>
      buildCommitMonthlyCalldata(
        period,
        list,
        await attest(period, signedList),
      );
    const anyone = keys.depositor.address;
    const setMonthly = (key: string, value: bigint, enabled: boolean) =>
      send(
        entry,
        key,
        keys.owner,
        vault,
        encodeFunctionData({
          abi: VAULT,
          functionName: "setMonthlyCommitment",
          args: [value, enabled],
        }),
      );
    const full = entries(items);
    // Off at vault creation: nobody can commit a signed allocation.
    if (!entry.checks.offAtCreation) {
      expectEqual(
        "monthly enabled at creation",
        await chain.read<boolean>(vault, VAULT, "monthlyEnabled"),
        false,
      );
      entry.checks.offAtCreation = {
        monthlyEnabled: false,
        revert: await refuse(
          anyone,
          vault,
          await commitData(periods.open, full),
        ),
      };
      expectEqual(
        "commit while off",
        (entry.checks.offAtCreation as { revert: string }).revert,
        "MonthlyDisabled",
      );
    }
    await expectRefusal(
      entry,
      "zero-cap-refused",
      "InvalidInput",
      keys.owner.address,
      vault,
      encodeFunctionData({
        abi: VAULT,
        functionName: "setMonthlyCommitment",
        args: [0n, true],
      }),
    );
    await setMonthly("monthly:on", cap, true);
    // The 72-hour cutoff: only the period whose window is open accepts.
    if (!entry.checks.window) {
      const [opensAt, closesAt] = await chain.read<readonly [bigint, bigint]>(
        vault,
        VAULT,
        "monthlyWindow",
        [Number(periods.open.replace("-", ""))],
      );
      const [year, month] = periods.open.split("-").map(Number);
      const expectedOpen = BigInt(Date.UTC(year, month, 1) / 1000 + 72 * 3600);
      const expectedClose = BigInt(
        Date.UTC(year, month + 1, 1) / 1000 + 72 * 3600,
      );
      expectEqual("window opens", opensAt, expectedOpen);
      expectEqual("window closes", closesAt, expectedClose);
      entry.checks.window = {
        period: periods.open,
        opensAt: new Date(Number(opensAt) * 1000).toISOString(),
        closesAt: new Date(Number(closesAt) * 1000).toISOString(),
        nextPeriod: periods.next,
        nextPeriodRevert: await refuse(
          anyone,
          vault,
          await commitData(periods.next, full),
        ),
        closedPeriod: periods.closed,
        closedPeriodRevert: await refuse(
          anyone,
          vault,
          await commitData(periods.closed, full),
        ),
      };
      const window = entry.checks.window as Record<string, string>;
      expectEqual(
        "next period",
        window.nextPeriodRevert,
        "MonthlyWindowClosed",
      );
      expectEqual(
        "closed period",
        window.closedPeriodRevert,
        "MonthlyWindowClosed",
      );
    }
    // An allocation changed after signing no longer matches the attestation.
    const edited = entries([
      items[0],
      { ...items[1], gross: 120n * amounts.unit },
      items[2],
    ]);
    await expectRefusal(
      entry,
      "edited-allocation-refused",
      "InvalidAttestation",
      anyone,
      vault,
      await commitData(periods.open, edited, full),
    );
    // The owner's cap edits apply to the next commitment.
    await setMonthly("monthly:cap-lowered", 200n * amounts.unit, true);
    await expectRefusal(
      entry,
      "over-cap-refused",
      "MonthlyCapExceeded",
      anyone,
      vault,
      await commitData(periods.open, full),
    );
    await setMonthly("monthly:cap-restored", cap, true);
    // Opt-out: the owner turns the commitment off, then on again.
    await setMonthly("monthly:opt-out", cap, false);
    await expectRefusal(
      entry,
      "opted-out-refused",
      "MonthlyDisabled",
      anyone,
      vault,
      await commitData(periods.open, full),
    );
    await setMonthly("monthly:opt-in", cap, true);
    // Manual path first: the owner commits and pays the first award itself.
    const wallets = actors.map((_, n) => wallet(`monthly:${n}`));
    await commit(entry, "monthly:manual-commit-x", vault, items[0]);
    await bind(entry, "monthly:bind-x", vault, actors[0], wallets[0], 0n);
    await pay(
      entry,
      "monthly:manual-pay-x",
      vault,
      asset,
      items[0],
      1n,
      wallets[0].address,
    );
    // A changed award for the manually committed source fails closed.
    await expectRefusal(
      entry,
      "changed-manual-award-refused",
      "DuplicateAward",
      anyone,
      vault,
      await commitData(
        periods.open,
        entries([
          { ...items[0], gross: 90n * amounts.unit },
          items[1],
          items[2],
        ]),
      ),
    );
    /**
     * The V2 path. The identity test key signs the reservation that
     * prepareEvmMonthlyReservation returns (the attester's own `reserve`
     * step), the payment API publishes it, and the project-operated keeper
     * (runKeeper) reads it through the public routes, sends reserveMonthly,
     * commits each leaf and pays each bound award. The relayer key is the
     * keeper's dedicated gas signer; it has no vault role.
     */
    async function keeperCommitment() {
      const period = periods.open;
      const pinned = services.registry.record([monthlyProject()]);
      const environment = {
        PAYMENT_DEPLOYMENTS: JSON.stringify(pinned),
        PAYMENT_RPC_URLS: JSON.stringify({ [network]: ctx.rpcUrl }),
      };
      const target = { network, vault };
      const config = async () => {
        const deployment = await preflightEvmDeployment(environment, target);
        return { ...deployment, chainId: BigInt(deployment.chainId) };
      };
      const latestBlock = Object.values(entry.steps).reduce(
        (max, step) =>
          BigInt(step.block ?? "0") > max ? BigInt(step.block ?? "0") : max,
        0n,
      );
      // The reservation reads the source sequence and funded awards at the
      // finalized block, so every earlier monthly step must be final first.
      await ready(async () => {
        const finalized = await chain.finalizedNumber();
        if (finalized < latestBlock)
          throw new Waiting(
            `the monthly reservation waits for finality (block ${latestBlock}, finalized ${finalized})`,
          );
      });
      if (!entry.checks.keeperAuthorization) {
        const snapshotSha256 = sha256Text(
          JSON.stringify(full, (_, v) =>
            typeof v === "bigint" ? v.toString() : v,
          ),
        );
        const prepared = await prepareEvmMonthlyReservation(
          await config(),
          period,
          `0x${snapshotSha256}`,
          full,
        );
        if (!prepared) throw new Error("The vault has no V2 monthly reserve");
        // The manually committed award is funded and stays out of the reserve.
        expectEqual(
          "V2 reserve sources",
          prepared.entries.map((e) => e.sourceDigest).join(","),
          [items[1].source, items[2].source].join(","),
        );
        const messageHex = evmMonthlyReserveDigest(
          BigInt(chainId),
          vault,
          period,
          prepared.reservation,
        ).slice(2);
        const authorization: MonthlyAuthorization = {
          plan: {
            request: {
              projectId: monthlyProjectId,
              period,
              network: network as EscrowDeployment["network"],
              snapshotSha256,
            },
            deployment: entry.checks.deployment as EscrowDeployment,
            allocationRoot: prepared.reservation.allocationRoot,
            messageHex,
            family: "evm",
            totalGrossBase: prepared.reservation.wholeGross,
            entries: prepared.entries.map((e) => ({
              githubUserId: e.githubUserId,
              grossMicro: String(e.grossMicro),
              sourceDigest: e.sourceDigest,
            })),
            evmReservation: prepared.reservation,
          },
          signatureHex: (
            await identity.sign({ hash: `0x${messageHex}` })
          ).slice(2),
        };
        // Publish the frozen month as the payments coordinator stores it.
        const manifest = services.registry.sqlite
          .query<{ manifest: string; manifest_sha256: string }, [string]>(
            "SELECT manifest,manifest_sha256 FROM projects WHERE id=?",
          )
          .get(monthlyProjectId);
        if (!manifest) throw new Error("Monthly registry project missing");
        const now = new Date().toISOString();
        const db = services.projection.sqlite;
        db.transaction(() => {
          db.prepare(
            "INSERT INTO monthly_reward_bases(project_id,period,manifest,manifest_sha256,source_snapshot_sha256,cap_base,recipient_count,created_at) VALUES(?,?,?,?,?,?,?,?)",
          ).run(
            monthlyProjectId,
            period,
            manifest.manifest,
            manifest.manifest_sha256,
            snapshotSha256,
            text(cap),
            full.length,
            now,
          );
          db.prepare(
            "INSERT INTO monthly_payment_runs(project_id,period,trigger,actor_id,allocation_sequence,snapshot,snapshot_sha256,network,vault,total_gross_base,frozen_at,obligations_created_at) VALUES(?,?,'automatic',NULL,0,?,?,?,?,?,?,?)",
          ).run(
            monthlyProjectId,
            period,
            JSON.stringify(full, (_, v) =>
              typeof v === "bigint" ? v.toString() : v,
            ),
            snapshotSha256,
            network,
            vault,
            prepared.reservation.wholeGross,
            now,
            now,
          );
          db.prepare(
            "INSERT INTO monthly_payment_authorizations(project_id,period,network,snapshot_sha256,authorization,published_at) VALUES(?,?,?,?,?,?)",
          ).run(
            monthlyProjectId,
            period,
            network,
            snapshotSha256,
            JSON.stringify(authorization),
            now,
          );
        })();
        entry.checks.keeperAuthorization = authorization;
        await persist();
      }
      const authorization = entry.checks
        .keeperAuthorization as MonthlyAuthorization;
      const reservation = authorization.plan
        .evmReservation as EvmMonthlyReservation;
      const tree = evmMonthlySumTree(authorization.plan.entries);
      const keeper = keeperRunner(
        services,
        monthlyProjectId,
        join(directory, "monthly", "keeper.sqlite"),
      );
      const outcome = (results: KeeperResult[]) =>
        [
          ...new Set(
            results.map(
              (r) =>
                `${r.operation} ${r.state}${r.error ? ` (${r.error})` : ""}`,
            ),
          ),
        ]
          .slice(0, 4)
          .join(" | ");
      // Admission, then the leaves, each after the previous step is final.
      await ready(async () => {
        const results = await keeper.tick();
        const state = await readEvmMonthlyReserve(await config(), period);
        if (state.root === tree.hash && state.remaining === 0n) return;
        throw new Waiting(
          `keeper monthly ${BigInt(state.root) === 0n ? "reservation" : "leaves"} wait for finality (${outcome(results)})`,
        );
      });
      const reserveKey = `monthly:v2:${network}:${vault}:${period}`;
      const sent: [string, string][] = [
        ["monthly:reserve", reserveKey],
        ...authorization.plan.entries.map(
          (_, index) =>
            [
              `monthly:leaf-${index}`,
              `${reserveKey}:${tree.hash}:leaf:${index}`,
            ] as [string, string],
        ),
      ];
      const receipts: Record<string, Receipt> = {};
      for (const [label, key] of sent) {
        const attempt = await keeper.journal<{ transactionId: string }>(key);
        const receipt = attempt && (await chain.receipt(attempt.transactionId));
        if (receipt?.status !== "0x1")
          throw new Error(`${label}: no successful keeper transaction`);
        receipts[label] = receipt;
        entry.steps[label] = {
          transactionId: receipt.transactionHash,
          from: keeperKey.address.toLowerCase(),
          status: "success",
          block: text(BigInt(receipt.blockNumber)),
          note: "Submitted by the project-operated keeper (scripts/payment-keeper, submitEvmMonthly V2)",
        };
      }
      const reserved = log(
        receipts["monthly:reserve"],
        vault,
        "MonthlyReserved",
      );
      expectEqual(
        "V2 whole gross",
        reserved.wholeGross,
        reservation.wholeGross,
      );
      expectEqual(
        "V2 remaining gross",
        reserved.remainingGross,
        items[1].gross + items[2].gross,
      );
      expectEqual("V2 count", reserved.count, 2);
      const reserveBlock = receipts["monthly:reserve"].blockNumber;
      const freeReserved =
        (await chain.read<bigint>(
          vault,
          VAULT,
          "freeBalance",
          [],
          at(reserveBlock, -1n),
        )) -
        (await chain.read<bigint>(
          vault,
          VAULT,
          "freeBalance",
          [],
          reserveBlock,
        ));
      // Only the two new awards reserve funds; the manual award counts once.
      expectEqual(
        "free balance reserved by monthly",
        freeReserved,
        items[1].gross + items[2].gross,
      );
      for (const [index, entryItem] of authorization.plan.entries.entries()) {
        const item = items.find((i) => i.source === entryItem.sourceDigest);
        const committed = log(
          receipts[`monthly:leaf-${index}`],
          vault,
          "AwardCommitted",
        );
        expectEqual(`V2 leaf ${index} gross`, committed.gross, item?.gross);
        expectEqual(`V2 leaf ${index} fee`, committed.fee, item?.fee);
      }
      entry.checks.commitment = {
        path: "keeper-v2",
        period,
        allocationDigest: reservation.allocationDigest,
        allocationRoot: reservation.allocationRoot,
        wholeGross: reservation.wholeGross,
        remainingGross: reservation.remainingGross,
        sourceSequence: reservation.sourceSequence,
        freeReserved: text(freeReserved),
        manualAwardStillPaid: (
          await chain.read<readonly unknown[]>(vault, VAULT, "awards", [
            items[0].id,
          ])
        )[5],
      };
      await persist();
      for (const n of [1, 2])
        await bind(
          entry,
          `monthly:bind-${n}`,
          vault,
          actors[n],
          wallets[n],
          0n,
        );
      // The keeper pays each bound award through the contract's binding.
      await ready(async () => {
        const results = await keeper.tick();
        const paid = await Promise.all(
          [1, 2].map(
            async (n) =>
              (
                await chain.read<readonly unknown[]>(vault, VAULT, "awards", [
                  items[n].id,
                ])
              )[5] === true,
          ),
        );
        if (paid.every(Boolean)) return;
        throw new Waiting(`keeper payments wait (${outcome(results)})`);
      });
      const fromBlock = BigInt(entry.steps["monthly:leaf-0"].block ?? "0");
      for (const n of [1, 2]) {
        const [found] = await getLogs(
          {
            address: vault,
            topics: [
              keccak256(
                Buffer.from(
                  "Paid(bytes32,uint64,address,uint64,uint128,uint128,uint128)",
                ),
              ),
              items[n].id,
            ],
          },
          fromBlock,
        );
        const receipt = found && (await chain.receipt(found.transactionHash));
        if (!receipt) throw new Error(`monthly award ${n}: no Paid event`);
        const sender = (await chain.rpc("eth_getTransactionByHash", [
          receipt.transactionHash,
        ])) as { from: string };
        expectEqual(
          `monthly award ${n} payer`,
          sender.from.toLowerCase(),
          keeperKey.address.toLowerCase(),
        );
        const event = log(receipt, vault, "Paid");
        expectEqual(`monthly award ${n} net`, event.net, items[n].net);
        expectEqual(`monthly award ${n} fee`, event.fee, items[n].fee);
        expectEqual(
          `monthly award ${n} destination`,
          String(event.destination).toLowerCase(),
          wallets[n].address.toLowerCase(),
        );
        expectEqual(
          `monthly award ${n} destination delta`,
          await delta(asset, wallets[n].address, receipt),
          items[n].net,
        );
        entry.steps[`monthly:pay-${n}`] = {
          transactionId: receipt.transactionHash,
          from: keeperKey.address.toLowerCase(),
          status: "success",
          block: text(BigInt(receipt.blockNumber)),
          note: "Paid by the project-operated keeper (submitPermissionlessEvmPayment)",
        };
      }
      await persist();
      if (!entry.checks.replay) {
        const last = BigInt(entry.steps["monthly:pay-2"].block ?? "0");
        await ready(async () => {
          const finalized = await chain.finalizedNumber();
          if (finalized < last)
            throw new Waiting(
              `the keeper replay waits for finality (block ${last}, finalized ${finalized})`,
            );
        });
        const before = keeper.signatures();
        const results = await keeper.tick();
        if (keeper.signatures() !== before)
          throw new Error("Keeper replay signed another transaction");
        entry.checks.replay = {
          keeper: results.map((r) => ({
            operation: r.operation,
            state: r.state,
          })),
          signaturesUnchanged: true,
          reserveRevert: await refuse(
            anyone,
            vault,
            buildReserveMonthlyCalldata(
              period,
              reservation,
              `0x${authorization.signatureHex}`,
            ),
          ),
          legacyRevert: await refuse(
            anyone,
            vault,
            await commitData(periods.open, full),
          ),
          leafRevert: await refuse(
            anyone,
            vault,
            buildCommitMonthlyLeafCalldata(
              period,
              authorization.plan.entries[0],
              0,
              tree.proofs[0],
            ),
          ),
        };
        const replay = entry.checks.replay as Record<string, string>;
        expectEqual(
          "V2 reserve replay",
          replay.reserveRevert,
          "MonthlyAlreadyCommitted",
        );
        expectEqual(
          "V2 legacy replay",
          replay.legacyRevert,
          "MonthlyAlreadyCommitted",
        );
        expectEqual(
          "V2 leaf replay",
          replay.leafRevert,
          "InvalidAllocationProof",
        );
        await persist();
      }
    }
    if (keeperPath) await keeperCommitment();
    else await executorCommitment();
    // The legacy path: the production executor submits the signed allocation.
    async function executorCommitment() {
      // Automatic path: the production executor submits the signed allocation.
      const signature = (await attest(periods.open, full)).slice(2);
      const authorization = {
        plan: {
          request: {
            projectId: `acceptance-${run.runId.slice(0, 8)}-monthly`,
            period: periods.open,
            network,
            snapshotSha256: sha256Text(
              JSON.stringify(full, (_, v) =>
                typeof v === "bigint" ? v.toString() : v,
              ),
            ),
          },
          deployment: entry.checks.deployment,
          allocationRoot: evmAllocationRoot(full),
          messageHex: digest(periods.open, full).slice(2),
          family: "evm",
          totalGrossBase: text(
            items.reduce((sum, item) => sum + item.gross, 0n),
          ),
          entries: full.map((e) => ({
            ...e,
            grossMicro: text(BigInt(e.grossMicro)),
          })),
        },
        signatureHex: signature,
      };
      const submit = async () => {
        const response = await services.relayer.fetch(
          new Request("https://payments-executor.internal/v1/commit-monthly", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(authorization),
          }),
        );
        return {
          ok: response.ok,
          body: (await response.json()) as Record<string, unknown>,
        };
      };
      const relayerNonce = async () =>
        BigInt(
          (await chain.rpc("eth_getTransactionCount", [
            keys.relayer.address,
            "pending",
          ])) as string,
        );
      const waitFinalized = (block: string, what: string) =>
        ready(async () => {
          const finalized = await chain.finalizedNumber();
          if (finalized < BigInt(block))
            throw new Waiting(
              `${what} waits for finality (block ${BigInt(block)}, finalized ${finalized})`,
            );
        });
      if (!entry.checks.commitment) {
        // The executor verifies the reviewed vault at the finalized block.
        await waitFinalized(
          entry.steps["monthly:create"].block ?? "0",
          "the monthly vault",
        );
        const freeBefore = await chain.read<bigint>(
          vault,
          VAULT,
          "freeBalance",
        );
        let transactionId =
          entry.steps["monthly:permissionless-commit"]?.transactionId;
        let path = "permissionless";
        if (!transactionId) {
          const submitted = await submit();
          if (submitted.ok) {
            transactionId = String(submitted.body.transactionId);
            path = "executor";
          } else {
            // The executor refuses a commitment above its reviewed gas ceiling.
            // The contract accepts the same signed allocation from anyone.
            const data = (await commitData(periods.open, full)) as Hex;
            const estimate = BigInt(
              (await chain.rpc("eth_estimateGas", [
                { from: keys.relayer.address, to: vault, data },
              ])) as string,
            );
            const ceiling = BigInt(
              (ctx.policy as { gasCeiling?: string }).gasCeiling ?? "0",
            );
            entry.checks.executorRefusal = {
              response: submitted.body,
              gasEstimate: text(estimate),
              executorGasLimit: text((estimate * 12n) / 10n),
              gasCeiling: text(ceiling),
            };
            await persist();
            if ((estimate * 12n) / 10n <= ceiling)
              throw new Waiting(
                `monthly executor refused: ${JSON.stringify(submitted.body)}`,
              );
            transactionId = (
              await send(
                entry,
                "monthly:permissionless-commit",
                keys.relayer,
                vault,
                data,
              )
            ).transactionHash;
          }
        } else path = "permissionless";
        let receipt: Receipt | null = null;
        await ready(async () => {
          receipt = await chain.receipt(String(transactionId));
          if (!receipt)
            throw new Waiting(`monthly commitment ${transactionId} not mined`);
        });
        const mined = receipt as unknown as Receipt;
        expectEqual("monthly commitment status", mined.status, "0x1");
        const event = log(mined, vault, "MonthlyCommitted");
        const freeAfter = await chain.read<bigint>(
          vault,
          VAULT,
          "freeBalance",
          [],
          mined.blockNumber,
        );
        const freeAtParent = await chain.read<bigint>(
          vault,
          VAULT,
          "freeBalance",
          [],
          at(mined.blockNumber, -1n),
        );
        expectEqual(
          "monthly gross",
          event.gross,
          authorization.plan.totalGrossBase,
        );
        expectEqual("monthly awards", event.awards, 3);
        // Only the two new awards reserve funds; the manual award counts once.
        expectEqual(
          "free balance reserved by monthly",
          freeAtParent - freeAfter,
          items[1].gross + items[2].gross,
        );
        entry.steps["monthly:commitment"] = {
          transactionId: String(transactionId),
          from: keys.relayer.address.toLowerCase(),
          status: "success",
          block: text(BigInt(mined.blockNumber)),
          note:
            path === "executor"
              ? "Submitted by the production executor (/v1/commit-monthly, submitEvmMonthly) with the identity authority's attestation"
              : "The production executor refused the commitment (gas above its reviewed ceiling, see executorRefusal); the relayer key submitted the same attested allocation permissionlessly",
        };
        entry.checks.commitment = {
          path,
          period: periods.open,
          allocationRoot: authorization.plan.allocationRoot,
          gross: text(event.gross as bigint),
          awards: text(event.awards as bigint),
          freeBefore: text(freeBefore),
          freeReserved: text(freeAtParent - freeAfter),
          manualAwardStillPaid: (
            await chain.read<readonly unknown[]>(vault, VAULT, "awards", [
              items[0].id,
            ])
          )[5],
        };
        await persist();
      }
      if (!entry.checks.replay) {
        await waitFinalized(
          entry.steps["monthly:commitment"].block ?? "0",
          "the monthly commitment",
        );
        const nonceBefore = await relayerNonce();
        const again = await submit();
        const nonceAfter = await relayerNonce();
        if (
          (again.ok &&
            again.body.alreadyCommitted !== true &&
            again.body.transactionId !==
              entry.steps["monthly:commitment"].transactionId) ||
          nonceAfter !== nonceBefore
        )
          throw new Error(
            "Executor replay submitted another monthly transaction",
          );
        entry.checks.replay = {
          executor: again,
          relayerNonceUnchanged: true,
          revert: await refuse(
            anyone,
            vault,
            await commitData(periods.open, full),
          ),
        };
        expectEqual(
          "monthly replay",
          (entry.checks.replay as { revert: string }).revert,
          "MonthlyAlreadyCommitted",
        );
        await persist();
      }
      for (const n of [1, 2]) {
        await bind(
          entry,
          `monthly:bind-${n}`,
          vault,
          actors[n],
          wallets[n],
          0n,
        );
        await pay(
          entry,
          `monthly:pay-${n}`,
          vault,
          asset,
          items[n],
          1n,
          wallets[n].address,
        );
      }
    }
    for (const n of [0, 1, 2])
      await expectRefusal(
        entry,
        `second-payment-${n}-refused`,
        "InvalidInput",
        keys.depositor.address,
        vault,
        buildPayCalldata(items[n].id, "1"),
      );
    const after = await totals(vault);
    expectEqual(
      "monthly paid",
      after.paid,
      items.reduce((s, i) => s + i.net, 0n),
    );
    expectEqual(
      "monthly fees",
      after.payoutFees,
      items.reduce((s, i) => s + i.fee, 0n),
    );
    expectEqual("monthly reserved", after.principalReserved, 0);
    entry.checks.totals = after;
    entry.checks.awards = items.map((item, n) => ({
      githubUserId: item.actor.githubUserId,
      gross: text(item.gross),
      net: text(item.net),
      fee: text(item.fee),
      destination: wallets[n].address.toLowerCase(),
      path:
        n === 0
          ? "manual commit and payment before the monthly commitment"
          : keeperPath
            ? "V2 monthly reserve and leaf, paid by the project-operated keeper"
            : "monthly commitment",
    }));
    const path = (entry.checks.commitment as { path: string }).path;
    entry.checks.automatic = keeperPath
      ? {
          passed: path === "keeper-v2",
          route: "scripts/payment-keeper (runKeeper, submitEvmMonthly V2)",
        }
      : { passed: path === "executor", route: "/v1/commit-monthly" };
    await persist();
    if (!(entry.checks.automatic as { passed: boolean }).passed)
      throw new Waiting(
        "Monthly contract checks passed through a direct permissionless commitment. Automatic executor acceptance is incomplete: the executor refused its reviewed gas ceiling. Use a new run after an approved executor repair; do not increase limits or count the direct send as automatic success.",
      );
  }

  // ---- 3. walletless destination lifecycle ---------------------------------
  async function lifecycle(entry: ScenarioEvidence) {
    const asset = scenarioAsset;
    const amounts = await amountsFor(asset);
    const vault = await vaultFor(entry, "lifecycle", asset);
    await fund(entry, "lifecycle", vault, asset, 100n * amounts.unit);
    const actor = scenarioActor(2, 0);
    const item = award(vault, "lifecycle", actor, amounts.award(50n));
    await commit(entry, "lifecycle:commit", vault, item);
    const [w1, w2, w3] = [1, 2, 3].map((n) => wallet(`lifecycle:${n}`));
    // Walletless: the award stays reserved and nothing can pay it.
    await expectRefusal(
      entry,
      "walletless-unpayable",
      "InvalidBinding",
      keys.depositor.address,
      vault,
      buildPayCalldata(item.id, "1"),
    );
    // A wallet signature for another network or another vault is refused.
    const otherChain = BigInt(chainId) === 84532n ? 11155111n : 84532n;
    await expectRefusal(
      entry,
      "wrong-network-refused",
      "InvalidWalletSignature",
      identity.address,
      vault,
      await bindingCall(vault, actor, w1, 0n, { chainId: otherChain }),
    );
    await expectRefusal(
      entry,
      "wrong-vault-refused",
      "InvalidWalletSignature",
      identity.address,
      vault,
      await bindingCall(vault, actor, w1, 0n, { vault: ctx.factory }),
    );
    await bind(entry, "lifecycle:bind-1", vault, actor, w1, 0n);
    // Replacement activates at once and supersedes version 1.
    const replaced = await bind(
      entry,
      "lifecycle:replace-2",
      vault,
      actor,
      w2,
      1n,
    );
    const bound = log(replaced, vault, "DestinationBound");
    expectEqual(
      "replacement activation",
      bound.activatesAt,
      await blockTime(replaced.blockNumber),
    );
    await expectRefusal(
      entry,
      "stale-version-bind-refused",
      "InvalidBinding",
      identity.address,
      vault,
      await bindingCall(vault, actor, w3, 1n),
    );
    await expectRefusal(
      entry,
      "stale-version-pay-refused",
      "InvalidBinding",
      keys.depositor.address,
      vault,
      buildPayCalldata(item.id, "1"),
    );
    // Zero binding delay (owner decision): there is no owner cancellation window.
    await expectRefusal(
      entry,
      "cancel-without-window-refused",
      "InvalidBinding",
      keys.owner.address,
      vault,
      buildCancelBindingCalldata(actor.githubUserId, "2"),
    );
    // Recovery: a new co-signed version pays at once.
    const recovered = await bind(
      entry,
      "lifecycle:recover-3",
      vault,
      actor,
      w3,
      2n,
    );
    const payable = await chain.read<readonly [string, bigint]>(
      vault,
      VAULT,
      "payableBinding",
      [BigInt(actor.githubUserId)],
      recovered.blockNumber,
    );
    expectEqual(
      "payable after recovery",
      `${payable[0].toLowerCase()}:${payable[1]}`,
      `${w3.address.toLowerCase()}:3`,
    );
    const paid = await pay(
      entry,
      "lifecycle:pay-3",
      vault,
      asset,
      item,
      3n,
      w3.address,
    );
    for (const [label, w] of [
      ["first", w1],
      ["replaced", w2],
    ] as const)
      expectEqual(
        `${label} wallet received`,
        await chain.balance(asset, w.address),
        0,
      );
    entry.checks.lifecycle = {
      actor: actor.githubUserId,
      wallets: [w1, w2, w3].map((w) => w.address.toLowerCase()),
      recoveredAt: text(await blockTime(recovered.blockNumber)),
      paidAt: text(await blockTime(paid.blockNumber)),
      bindingDelaySeconds: text(ctx.bindingDelay),
    };
    await persist();
    if (!reviewFactory) {
      entry.checks.reviewWindow =
        "not run: ESCROW_ACCEPTANCE_REVIEW_FACTORY is not set";
      return;
    }
    // Cancel and recover inside a review window (a test factory whose only
    // difference from the deployed one is a 120-second binding delay).
    const reviewDelay = await chain.read<bigint>(
      reviewFactory,
      FACTORY,
      "bindingDelay",
    );
    if (reviewDelay === 0n)
      throw new Error("Review factory has no binding delay");
    const reviewIdentity = await chain.read<string>(
      reviewFactory,
      FACTORY,
      "identityAuthority",
    );
    expectEqual(
      "review factory identity",
      reviewIdentity.toLowerCase(),
      identity.address.toLowerCase(),
    );
    // The cancellation must be mined inside the 120-second window. A run
    // interrupted past it continues in a new vault (a new label).
    const attempt = Number(entry.checks.reviewAttempt ?? 0);
    const label = attempt ? `lifecycle-review-${attempt}` : "lifecycle-review";
    const review = await vaultFor(entry, label, asset, {
      factory: reviewFactory,
    });
    const [r1, r2] = [1, 2].map((n) => wallet(`${label}:${n}`));
    await fund(entry, label, review, asset, 100n * amounts.unit);
    const reviewActor = scenarioActor(2, 1);
    const reviewItem = award(review, label, reviewActor, amounts.award(50n));
    const committed = await commit(
      entry,
      `${label}:commit`,
      review,
      reviewItem,
    );
    const reviewBound = await bind(
      entry,
      `${label}:bind-1`,
      review,
      reviewActor,
      r1,
      0n,
    );
    if (!entry.steps[`${label}:cancel-1`]) {
      const closes = (await blockTime(reviewBound.blockNumber)) + reviewDelay;
      if ((await chain.latestTime()) + 30n >= closes) {
        entry.checks.reviewAttempt = attempt + 1;
        await persist();
        throw new Waiting(
          "the review window passed before the cancellation; the next run uses a new review vault",
        );
      }
    }
    const cancelled = await send(
      entry,
      `${label}:cancel-1`,
      keys.owner,
      review,
      buildCancelBindingCalldata(reviewActor.githubUserId, "1") as Hex,
    );
    log(cancelled, review, "BindingCancelled");
    await expectRefusal(
      entry,
      "review:cancel-again-refused",
      "InvalidBinding",
      keys.owner.address,
      review,
      buildCancelBindingCalldata(reviewActor.githubUserId, "1"),
    );
    await bind(entry, `${label}:recover-2`, review, reviewActor, r2, 1n);
    const maturesAt = (await blockTime(committed.blockNumber)) + reviewDelay;
    await ready(async () => {
      const now = await chain.latestTime();
      if (now < maturesAt)
        throw new Waiting(
          `review award matures at chain time ${maturesAt}`,
          new Date(Date.now() + Number(maturesAt - now) * 1000),
        );
    });
    await expectRefusal(
      entry,
      "review:cancelled-version-refused",
      "InvalidBinding",
      keys.depositor.address,
      review,
      buildPayCalldata(reviewItem.id, "1"),
    );
    await pay(
      entry,
      `${label}:pay-2`,
      review,
      asset,
      reviewItem,
      2n,
      r2.address,
    );
    entry.checks.reviewWindow = {
      factory: reviewFactory,
      bindingDelaySeconds: text(reviewDelay),
      actor: reviewActor.githubUserId,
      vault: review,
      cancelled: entry.steps[`${label}:cancel-1`].transactionId,
      cancelledWallet: r1.address.toLowerCase(),
      recoveredTo: r2.address.toLowerCase(),
    };
    await persist();
  }

  // ---- 4-6. production dispatch: interrupted send, failed recipient, frozen fee
  async function dispatch(
    interrupted: ScenarioEvidence,
    failed: ScenarioEvidence,
    frozen: ScenarioEvidence,
  ) {
    const proxy = new FaultRpc(ctx.rpcUrl);
    try {
      const projects = () =>
        [
          ["interrupted", interrupted],
          ["failed", failed],
        ]
          .filter(([, e]) => (e as ScenarioEvidence).checks.deployment)
          .map(([name, e]) => ({
            projectId: `acceptance-${run.runId.slice(0, 8)}-${name}`,
            effectiveCycle: run.startedAt.slice(0, 7),
            deployment: (e as ScenarioEvidence).checks
              .deployment as EscrowDeployment,
          }));
      const services = evmServices(
        ctx,
        join(directory, "dispatch"),
        projects,
        proxy.url,
      );
      const { projection, env } = services;
      const setUp = async (
        entry: ScenarioEvidence,
        name: string,
        asset: string,
        units: bigint[],
        actorSet: number,
      ) => {
        const amounts = await amountsFor(asset);
        const vault = await vaultFor(entry, name, asset);
        if (!entry.checks.deployment) {
          entry.checks.deployment = await evmDeploymentRecord(
            ctx,
            vault,
            asset,
            entry.steps[`${name}:create`].transactionId,
          );
          await persist();
        }
        services.refresh();
        await fund(
          entry,
          name,
          vault,
          asset,
          units.reduce((s, u) => s + u, 0n) * amounts.unit,
        );
        const items = units.map((u, n) =>
          award(
            vault,
            `${name}-${n}`,
            scenarioActor(actorSet, n),
            amounts.award(u),
          ),
        );
        for (const [n, item] of items.entries())
          await commit(entry, `${name}:commit-${n}`, vault, item);
        const wallets = items.map((_, n) => wallet(`${name}:${n}`));
        return { vault, asset, items, wallets };
      };
      const lost = await setUp(
        interrupted,
        "interrupted",
        scenarioAsset,
        [50n],
        3,
      );
      const blocked = await setUp(
        failed,
        "failed",
        blockable,
        [100n, 100n, 50n],
        4,
      );
      frozen.vaults.failed = blocked.vault;
      if (!frozen.assets.includes(blockable)) frozen.assets.push(blockable);
      const deps = {
        paymentDeployments: [lost.vault, blocked.vault].map((vault) => ({
          network,
          chain: ctx.policy.chain,
          vault,
          chainId,
        })),
      };
      const block = (entry: ScenarioEvidence, key: string, target: string) =>
        send(
          entry,
          key,
          keys.depositor,
          blockable,
          encodeFunctionData({
            abi: BLOCKABLE,
            functionName: "blockAddress",
            args: [target as Hex],
          }),
        );
      // The second recipient's address rejects the token before any dispatch.
      await block(
        failed,
        "failed:block-recipient-2",
        blocked.wallets[1].address,
      );
      for (const [set, entry] of [
        [lost, interrupted],
        [blocked, failed],
      ] as const)
        for (const [n, item] of set.items.entries())
          if (!entry.checks[`registered-${n}`]) {
            const registered = await registerEvmWallet({
              projection,
              actor: item.actor,
              chain: ctx.policy.chain,
              network,
              vault: set.vault,
              wallet: set.wallets[n],
              deps,
            });
            entry.checks[`registered-${n}`] = {
              claimId: registered.claimId,
              wallet: set.wallets[n].address.toLowerCase(),
            };
            await persist();
          }
      const ledger = (id: string) => projection.obligation(id)?.state ?? "none";
      const onChainPaid = async (vault: string, id: string) =>
        (
          await chain.read<readonly unknown[]>(vault, VAULT, "awards", [id])
        )[5] === true;
      // Lose the answer to the first broadcast of the interrupted award's payment.
      const payPrefix = buildPayCalldata(lost.items[0].id, "1")
        .slice(0, 74)
        .toLowerCase();
      const armLoss = () => {
        if (interrupted.checks.lostResponse || proxy.isArmed) return;
        proxy.arm({
          send: "eth_sendRawTransaction",
          lookups: ["eth_getTransactionByHash"],
          match: (call) => {
            const raw = String(call.params[0]);
            return raw.toLowerCase().includes(payPrefix.slice(2));
          },
          onLoss: async (call, upstream) => {
            interrupted.checks.lostResponse = {
              transactionId: keccak256(String(call.params[0]) as Hex),
              nodeAnswerDiscarded: upstream.slice(0, 200),
              at: new Date().toISOString(),
            };
            await persist();
          },
        });
      };
      armLoss();
      const cronLog: string[][] = [];
      const tick = async () => {
        const errors = await runPaymentsCron(env);
        cronLog.push(errors);
        if (interrupted.checks.lostResponse && !interrupted.checks.restarted) {
          // A Worker restart after the lost answer: new signer instances, same journals.
          services.restart();
          interrupted.checks.restarted = new Date().toISOString();
          await persist();
        }
        return errors;
      };
      // Phase 1: the interrupted award and the unblocked recipients are paid;
      // the blocked recipient's attempt fails and its award stays reserved.
      if (!failed.checks.phase1) {
        await ready(async () => {
          const errors = await tick();
          const states = [lost.items[0], ...blocked.items].map((i) =>
            ledger(i.id),
          );
          if (
            states[0] === "paid" &&
            states[1] === "paid" &&
            states[3] === "paid"
          )
            return;
          throw new Waiting(
            `dispatch phase 1: ledger ${states.join(",")}${errors.length ? ` (cron: ${[...new Set(errors)].slice(0, 3).join(" | ")})` : ""}`,
          );
        });
        const second = blocked.items[1];
        if (await onChainPaid(blocked.vault, second.id))
          throw new Error("Blocked recipient was paid");
        const t = await totals(blocked.vault);
        expectEqual(
          "blocked award still reserved",
          t.principalReserved,
          second.net,
        );
        failed.checks.phase1 = {
          paid: [0, 2].map((n) => ({
            githubUserId: blocked.items[n].actor.githubUserId,
            ledger: ledger(blocked.items[n].id),
            transaction: projection.obligation(blocked.items[n].id)
              ?.paid_transaction,
          })),
          blocked: {
            githubUserId: second.actor.githubUserId,
            ledger: ledger(second.id),
            outbox: projection.outbox(second.id),
            attempts: projection.attempts(second.id),
            paidOnChain: false,
            reservedPrincipal: t.principalReserved,
          },
          cronErrors: [...new Set(cronLog.flat())].slice(0, 10),
        };
        await persist();
      }
      // Interrupted send: one payment, one transaction, one attempt.
      if (!interrupted.checks.result) {
        const item = lost.items[0];
        const obligation = projection.obligation(item.id);
        const attempts = projection.attempts(item.id);
        const lossRecord = interrupted.checks.lostResponse as
          | { transactionId: string }
          | undefined;
        if (!lossRecord)
          throw new Error("The payment broadcast answer was never lost");
        const paidLogs = await getLogs(
          {
            address: lost.vault,
            topics: [
              keccak256(
                Buffer.from(
                  "Paid(bytes32,uint64,address,uint64,uint128,uint128,uint128)",
                ),
              ),
              item.id,
            ],
          },
          BigInt(interrupted.steps["interrupted:commit-0"].block ?? "0"),
        );
        const journaled = await services.relayerJournal.get<{
          transactionId: string;
        }>(`pay:${attempts[0]?.id}`);
        expectEqual("attempts", attempts.length, 1);
        expectEqual("Paid events", paidLogs.length, 1);
        expectEqual(
          "paid transaction is the lost one",
          paidLogs[0].transactionHash,
          lossRecord.transactionId,
        );
        expectEqual(
          "ledger transaction",
          obligation?.paid_transaction,
          lossRecord.transactionId,
        );
        expectEqual(
          "journaled transaction",
          journaled?.transactionId,
          lossRecord.transactionId,
        );
        const receipt = await chain.receipt(lossRecord.transactionId);
        if (!receipt) throw new Error("Lost payment has no receipt");
        expectEqual(
          "wallet received once",
          // The movement of this payment only: the wallet comes from the reused actor key.
          await delta(lost.asset, lost.wallets[0].address, receipt),
          item.net,
        );
        interrupted.steps["interrupted:pay"] = {
          transactionId: lossRecord.transactionId,
          from: keys.relayer.address.toLowerCase(),
          status: "success",
          block: text(BigInt(receipt.blockNumber)),
          note: "Signed once by the production executor; its broadcast answer was discarded and the next lookup failed, then the cron recovered the journaled attempt",
        };
        interrupted.checks.result = {
          attempts,
          paidEvents: paidLogs.map((l) => l.transactionHash),
          ledger: obligation?.state,
          walletReceived: text(item.net),
          secondPayment: await refuse(
            keys.depositor.address,
            lost.vault,
            buildPayCalldata(item.id, "1"),
          ),
        };
        expectEqual(
          "second payment",
          (interrupted.checks.result as { secondPayment: string })
            .secondPayment,
          "InvalidInput",
        );
        await persist();
      }
      // Phase 2: the fee recipient rejects the token (this unblocks the second
      // recipient). Fees cannot be claimed, yet the waiting payout proceeds.
      await block(frozen, "frozen:block-fee-recipient", ctx.feeRecipient);
      if (!frozen.checks.claimRefused) {
        frozen.checks.claimRefused = {
          revert: await refuse(
            keys.depositor.address,
            blocked.vault,
            buildClaimFeesCalldata(),
          ),
        };
        expectEqual(
          "frozen claim",
          (frozen.checks.claimRefused as { revert: string }).revert,
          "TransferFailed",
        );
        await persist();
      }
      await send(
        frozen,
        "frozen:claim-fees-reverted",
        keys.depositor,
        blocked.vault,
        buildClaimFeesCalldata() as Hex,
        { gas: 300_000n, expect: "reverted" },
      );
      if (!failed.checks.phase2) {
        await ready(async () => {
          const errors = await tick();
          if (ledger(blocked.items[1].id) === "paid") return;
          throw new Waiting(
            `dispatch phase 2: blocked recipient ${ledger(blocked.items[1].id)}${errors.length ? ` (cron: ${[...new Set(errors)].slice(0, 3).join(" | ")})` : ""}`,
          );
        });
        const item = blocked.items[1];
        const attempts = projection.attempts(item.id);
        expectEqual("retried attempts", attempts.length, 1);
        const paidTransaction = projection.obligation(
          item.id,
        )?.paid_transaction;
        const paidReceipt = paidTransaction
          ? await chain.receipt(paidTransaction)
          : null;
        if (!paidReceipt)
          throw new Error("Second recipient payment has no receipt");
        expectEqual(
          "second recipient received",
          await delta(blockable, blocked.wallets[1].address, paidReceipt),
          item.net,
        );
        failed.checks.phase2 = {
          githubUserId: item.actor.githubUserId,
          attempts,
          paidTransaction: projection.obligation(item.id)?.paid_transaction,
          paidWhileFeeRecipientBlocked: true,
        };
        frozen.checks.payoutDuringFreeze = failed.checks.phase2;
        await persist();
      }
      // Phase 3: the fee recipient accepts the token again; one claim moves every accrued fee.
      await block(frozen, "frozen:unblock", ZERO);
      const fees = blocked.items.reduce((sum, item) => sum + item.fee, 0n);
      const claimed = await claim(
        frozen,
        "frozen:claim-fees",
        blocked.vault,
        blockable,
        fees,
      );
      await claim(
        interrupted,
        "interrupted:claim-fees",
        lost.vault,
        lost.asset,
        lost.items[0].fee,
      );
      interrupted.checks.complete = true;
      const after = await totals(blocked.vault);
      expectEqual(
        "failed vault paid",
        after.paid,
        blocked.items.reduce((s, i) => s + i.net, 0n),
      );
      // Nothing owed stays in the vault: any balance left is the owner's free funds.
      for (const field of ["principalReserved", "feesReserved", "feesAccrued"])
        expectEqual(`failed vault ${field}`, after[field], 0);
      // Free funds are every recorded deposit less the gross of the three awards.
      expectEqual(
        "failed vault free",
        after.free,
        BigInt(after.deposited) -
          blocked.items.reduce((sum, item) => sum + item.gross, 0n),
      );
      expectEqual("failed vault balance", after.balance, after.free);
      frozen.checks.claimed = {
        amount: text(fees),
        transaction: claimed.transactionHash,
        totals: after,
      };
      failed.checks.totals = after;
      failed.checks.complete = true;
      frozen.checks.complete = true;
      await persist();
    } finally {
      proxy.stop();
    }
  }

  // ---- 5. identity key recovery --------------------------------------------
  /**
   * The registrar rotates the factory identity authority to a recovery key,
   * as the key recovery runbook (contracts/evm/README.md) prescribes for a
   * lost or compromised attester key. The old key can no longer bind, a
   * binding made before the rotation still pays, and the recovery key binds a
   * new destination that pays. The registrar then rotates the authority back,
   * so the factory leaves the run with its configured identity authority.
   */
  async function keyRecovery(entry: ScenarioEvidence) {
    const recovery = ctx.recovery;
    if (!recovery)
      throw new Error(
        "ESCROW_ACCEPTANCE_RECOVERY_IDENTITY_KEY is required for the key-recovery scenario",
      );
    const factory = ctx.factory;
    const authorityAt = async (block: string) =>
      (
        await chain.read<string>(
          factory,
          FACTORY,
          "identityAuthority",
          [],
          block,
        )
      ).toLowerCase();
    const asset = scenarioAsset;
    const amounts = await amountsFor(asset);
    const vault = await vaultFor(entry, "recovery", asset);
    const actors = [0, 1].map((n) => scenarioActor(5, n));
    const items = [
      award(vault, "recovery-existing", actors[0], amounts.award(100n)),
      award(vault, "recovery-new", actors[1], amounts.award(50n)),
    ];
    const wallets = actors.map((_, n) => wallet(`recovery:${n}`));
    const rotate = async (
      label: string,
      from: PrivateKeyAccount,
      to: PrivateKeyAccount,
    ) => {
      // Already rotated on an earlier run: the stored steps are reused.
      if (
        !entry.steps[`recovery:${label}-propose`] &&
        (await authorityAt("latest")) === to.address.toLowerCase()
      )
        throw new Error(
          `recovery:${label}: the factory authority is already ${to.address} without a recorded rotation`,
        );
      const proposed = await send(
        entry,
        `recovery:${label}-propose`,
        keys.registrar,
        factory,
        encodeFunctionData({
          abi: FACTORY,
          functionName: "proposeIdentityAuthority",
          args: [to.address],
        }),
      );
      const executed = await send(
        entry,
        `recovery:${label}-execute`,
        keys.depositor,
        factory,
        encodeFunctionData({
          abi: FACTORY,
          functionName: "executeIdentityAuthorityRotation",
        }),
      );
      const event = (() => {
        for (const item of executed.logs) {
          if (item.address.toLowerCase() !== factory) continue;
          try {
            const decoded = decodeEventLog({
              abi: FACTORY,
              topics: item.topics as [Hex, ...Hex[]],
              data: item.data,
            });
            if (decoded.eventName === "IdentityAuthorityRotated")
              return decoded.args as { previous: string; current: string };
          } catch {}
        }
        throw new Error(`recovery:${label}: no IdentityAuthorityRotated event`);
      })();
      expectEqual(
        `recovery:${label} previous`,
        event.previous.toLowerCase(),
        from.address.toLowerCase(),
      );
      expectEqual(
        `recovery:${label} current`,
        event.current.toLowerCase(),
        to.address.toLowerCase(),
      );
      // Read at the execution block, so a resumed run checks the same state.
      expectEqual(
        `recovery:${label} factory authority`,
        await authorityAt(executed.blockNumber),
        to.address.toLowerCase(),
      );
      expectEqual(
        `recovery:${label} vault authority`,
        (
          await chain.read<string>(
            vault,
            VAULT,
            "identityAuthority",
            [],
            executed.blockNumber,
          )
        ).toLowerCase(),
        to.address.toLowerCase(),
      );
      return {
        proposal: proposed.transactionHash,
        execution: executed.transactionHash,
        block: text(BigInt(executed.blockNumber)),
        previous: event.previous.toLowerCase(),
        current: event.current.toLowerCase(),
      };
    };

    await fund(entry, "recovery", vault, asset, 150n * amounts.unit);
    for (const [n, item] of items.entries())
      await commit(entry, `recovery:commit-${n}`, vault, item);
    // The binding that exists before the key is lost.
    await bind(
      entry,
      "recovery:bind-existing",
      vault,
      actors[0],
      wallets[0],
      0n,
    );

    if (!entry.checks.rotation)
      entry.checks.rotation = await rotate("rotate", identity, recovery);
    await persist();
    // The old key can no longer bind; the new authority can.
    if (!entry.checks.oldKeyRefused) {
      const data = await bindingCall(vault, actors[1], wallets[1], 0n);
      const revert = await refuse(identity.address, vault, data);
      expectEqual("old identity key bind", revert, "Unauthorized");
      entry.checks.oldKeyRefused = {
        from: identity.address.toLowerCase(),
        revert,
      };
      await persist();
    }
    // The binding made by the old key still pays after the rotation.
    const existing = await pay(
      entry,
      "recovery:pay-existing",
      vault,
      asset,
      items[0],
      1n,
      wallets[0].address,
    );
    await bind(
      entry,
      "recovery:bind-new",
      vault,
      actors[1],
      wallets[1],
      0n,
      recovery,
    );
    const fresh = await pay(
      entry,
      "recovery:pay-new",
      vault,
      asset,
      items[1],
      1n,
      wallets[1].address,
    );
    entry.checks.payments = {
      existingBinding: {
        githubUserId: actors[0].githubUserId,
        boundBy: identity.address.toLowerCase(),
        paidAfterRotation: existing.transactionHash,
        net: text(items[0].net),
      },
      newBinding: {
        githubUserId: actors[1].githubUserId,
        boundBy: recovery.address.toLowerCase(),
        paid: fresh.transactionHash,
        net: text(items[1].net),
      },
    };
    await persist();
    // Restore the configured identity authority for later runs.
    if (!entry.checks.restoration)
      entry.checks.restoration = await rotate("restore", recovery, identity);
    expectEqual(
      "restored identity authority",
      await authorityAt("latest"),
      identity.address.toLowerCase(),
    );
    const after = await totals(vault);
    expectEqual(
      "recovery paid",
      after.paid,
      items.reduce((sum, item) => sum + item.net, 0n),
    );
    expectEqual("recovery reserved", after.principalReserved, 0);
    entry.checks.totals = after;
    await persist();
  }

  const priorMonthly = run.scenarios?.monthly;
  const priorAutomatic = priorMonthly?.checks.automatic as
    | { path?: string }
    | undefined;
  if (priorMonthly && priorAutomatic?.path) {
    priorMonthly.checks.commitment = priorAutomatic;
    delete priorMonthly.checks.automatic;
    const oldStep = priorMonthly.steps["monthly:automatic-commit"];
    if (oldStep) {
      priorMonthly.steps["monthly:commitment"] = oldStep;
      delete priorMonthly.steps["monthly:automatic-commit"];
    }
    priorMonthly.status = "pending";
    await persist();
  }
  try {
    const recovery: [string[], (entry: ScenarioEvidence) => Promise<void>] = [
      ["key-recovery"],
      keyRecovery,
    ];
    await runScenarios(
      run,
      persist,
      [
        // A run interrupted while the recovery key is in force restores the
        // configured authority before any other scenario binds.
        ...(ctx.identityRotated ? [recovery] : []),
        [["bounty"], bounty],
        [["walletless-lifecycle"], lifecycle],
        [["monthly"], monthly],
        [
          ["interrupted-send", "failed-recipient", "frozen-fee-destination"],
          dispatch,
        ],
        ...(ctx.identityRotated ? [] : [recovery]),
      ],
      async (entry) => {
        entry.checks.finality = await ready(() =>
          chain.finalizeSteps(entry.steps),
        );
      },
    );
    run.status = "passed";
  } catch (error) {
    if (error instanceof Waiting) {
      run.status = "waiting";
      run.waiting = {
        reason: error.message,
        until: error.until?.toISOString() ?? null,
      };
    } else {
      run.status = "failed";
      run.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  await persist();
  return run;
}
