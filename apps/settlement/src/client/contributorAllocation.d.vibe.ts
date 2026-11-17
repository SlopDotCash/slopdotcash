import { Effect } from "effect";
import { type Allocation, type Event, Rejected } from "../../gen/settlement__contributorAllocation.effect.vibe";
import { type Chain, type NetworkKey } from "../kernels/networks.ts";
import type { AccountWallet } from "./public.vibe";
export declare const contributorAllocationUrl = "/contributor-allocation.json";
declare const AllocationUnverified_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "AllocationUnverified";
} & Readonly<A>;
export declare class AllocationUnverified extends AllocationUnverified_base<{
    readonly message: string;
}> {
}
export interface AllocationToken {
    readonly symbol: string;
    readonly decimals: number;
    readonly address: string;
}
export interface AllocationRecipient {
    readonly githubId: string;
    readonly amountBase: string;
    readonly transactionId: string | null;
}
export interface ContributorAllocation {
    readonly network: NetworkKey;
    readonly chain: Chain;
    readonly token: AllocationToken;
    readonly registrationClosesAt: string;
    readonly closed: boolean;
    readonly recipients: ReadonlyArray<AllocationRecipient>;
    readonly digest: string;
}
export type AllocationState = "sent" | "scheduled" | "awaiting-wallet" | "unclaimed";
export interface AllocationStep {
    readonly event: Event;
    readonly by: string;
}
export interface RecipientAllocation {
    readonly recipient: AllocationRecipient;
    readonly state: AllocationState;
    readonly allocation: Allocation;
}
export declare function contributorAllocation(text: string): Effect.Effect<{
    network: "base-mainnet" | "base-sepolia" | "ethereum" | "ethereum-sepolia" | "robinhood-mainnet" | "robinhood-testnet" | "solana-devnet" | "solana-mainnet" | "solana-testnet";
    chain: "base" | "ethereum" | "robinhood";
    token: {
        symbol: string;
        decimals: number;
        address: string;
    };
    registrationClosesAt: string;
    closed: boolean;
    recipients: AllocationRecipient[];
    digest: string;
} | undefined, AllocationUnverified, import("vibelang-runtime/experimental/Crypto").Crypto>;
export declare function replayed(steps: ReadonlyArray<AllocationStep>, start?: Allocation): Effect.Effect<Allocation, Rejected, never>;
export declare function receivedStep(steps: ReadonlyArray<AllocationStep>, raw: unknown, by: string, start?: Allocation): Effect.Effect<{
    step: AllocationStep;
    state: Allocation;
}, import("../../gen/settlement__contributorAllocation.effect.vibe").NotAnEvent | Rejected, never>;
export declare function recipientAllocation(allocation: ContributorAllocation, viewer: string, wallets: ReadonlyArray<AccountWallet>, nowMillis: number): Effect.Effect<{
    recipient: AllocationRecipient;
    state: AllocationState;
    allocation: Allocation;
} | undefined, never, never>;
export {};
