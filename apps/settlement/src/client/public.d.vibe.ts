import { Schema } from "effect";
import { type AnyRoute } from "@repo/platform/route";
export declare const PaymentAsset: Schema.Struct<{
    readonly network: Schema.String;
    readonly assetAddress: Schema.String;
    readonly assetDecimals: Schema.Number;
}>;
export type PaymentAsset = typeof PaymentAsset.Type;
export declare const PublicVaultPayment: Schema.Struct<{
    readonly id: Schema.String;
    readonly projectId: Schema.String;
    readonly network: Schema.String;
    readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
    readonly contributionMonth: Schema.Union<readonly [Schema.String, Schema.Null]>;
    readonly assetAddress: Schema.String;
    readonly assetDecimals: Schema.Number;
    readonly netBase: Schema.String;
    readonly transactionId: Schema.String;
    readonly indexedAt: Schema.String;
}>;
export type PublicVaultPayment = typeof PublicVaultPayment.Type;
export declare const PublicVaultPaymentPage: Schema.Struct<{
    readonly payments: Schema.$Array<Schema.Struct<{
        readonly id: Schema.String;
        readonly projectId: Schema.String;
        readonly network: Schema.String;
        readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
        readonly contributionMonth: Schema.Union<readonly [Schema.String, Schema.Null]>;
        readonly assetAddress: Schema.String;
        readonly assetDecimals: Schema.Number;
        readonly netBase: Schema.String;
        readonly transactionId: Schema.String;
        readonly indexedAt: Schema.String;
    }>>;
    readonly through: Schema.Number;
    readonly next: Schema.Union<readonly [Schema.Number, Schema.Null]>;
    readonly total: Schema.Number;
}>;
export type PublicVaultPaymentPage = typeof PublicVaultPaymentPage.Type;
export declare const DirectTransfer: Schema.Struct<{
    readonly projectId: Schema.String;
    readonly contributionMonth: Schema.String;
    readonly githubUserId: Schema.String;
    readonly login: Schema.String;
    readonly network: Schema.String;
    readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
    readonly recipient: Schema.String;
    readonly amountMicro: Schema.String;
    readonly transactionId: Schema.String;
    readonly blockTime: Schema.String;
}>;
export type DirectTransfer = typeof DirectTransfer.Type;
export declare const DirectTransferPage: Schema.Struct<{
    readonly transfers: Schema.$Array<Schema.Struct<{
        readonly projectId: Schema.String;
        readonly contributionMonth: Schema.String;
        readonly githubUserId: Schema.String;
        readonly login: Schema.String;
        readonly network: Schema.String;
        readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
        readonly recipient: Schema.String;
        readonly amountMicro: Schema.String;
        readonly transactionId: Schema.String;
        readonly blockTime: Schema.String;
    }>>;
    readonly totalMicro: Schema.String;
    readonly through: Schema.Number;
    readonly next: Schema.Union<readonly [Schema.Number, Schema.Null]>;
    readonly total: Schema.Number;
}>;
export type DirectTransferPage = typeof DirectTransferPage.Type;
export declare const DirectTransferList: Schema.Struct<{
    readonly transfers: Schema.$Array<Schema.Struct<{
        readonly projectId: Schema.String;
        readonly contributionMonth: Schema.String;
        readonly githubUserId: Schema.String;
        readonly login: Schema.String;
        readonly network: Schema.String;
        readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
        readonly recipient: Schema.String;
        readonly amountMicro: Schema.String;
        readonly transactionId: Schema.String;
        readonly blockTime: Schema.String;
    }>>;
    readonly totalMicro: Schema.String;
}>;
export type DirectTransferList = typeof DirectTransferList.Type;
export declare const DirectTransfers: Schema.Union<readonly [Schema.Struct<{
    readonly transfers: Schema.$Array<Schema.Struct<{
        readonly projectId: Schema.String;
        readonly contributionMonth: Schema.String;
        readonly githubUserId: Schema.String;
        readonly login: Schema.String;
        readonly network: Schema.String;
        readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
        readonly recipient: Schema.String;
        readonly amountMicro: Schema.String;
        readonly transactionId: Schema.String;
        readonly blockTime: Schema.String;
    }>>;
    readonly totalMicro: Schema.String;
    readonly through: Schema.Number;
    readonly next: Schema.Union<readonly [Schema.Number, Schema.Null]>;
    readonly total: Schema.Number;
}>, Schema.Struct<{
    readonly transfers: Schema.$Array<Schema.Struct<{
        readonly projectId: Schema.String;
        readonly contributionMonth: Schema.String;
        readonly githubUserId: Schema.String;
        readonly login: Schema.String;
        readonly network: Schema.String;
        readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
        readonly recipient: Schema.String;
        readonly amountMicro: Schema.String;
        readonly transactionId: Schema.String;
        readonly blockTime: Schema.String;
    }>>;
    readonly totalMicro: Schema.String;
}>]>;
export type DirectTransfers = typeof DirectTransfers.Type;
export declare const ReceivedProject: Schema.Struct<{
    readonly projectId: Schema.String;
    readonly usdMicro: Schema.String;
}>;
export type ReceivedProject = typeof ReceivedProject.Type;
export declare const OtherAsset: Schema.Struct<{
    readonly network: Schema.String;
    readonly assetAddress: Schema.String;
    readonly assetDecimals: Schema.Number;
    readonly netBase: Schema.String;
}>;
export type OtherAsset = typeof OtherAsset.Type;
export declare const ReceivedContributor: Schema.Struct<{
    readonly githubUserId: Schema.String;
    readonly login: Schema.Union<readonly [Schema.String, Schema.Null]>;
    readonly usdMicro: Schema.String;
    readonly directMicro: Schema.String;
    readonly vaultUsdMicro: Schema.String;
    readonly directTransfers: Schema.Number;
    readonly vaultPayments: Schema.Number;
    readonly projects: Schema.$Array<Schema.Struct<{
        readonly projectId: Schema.String;
        readonly usdMicro: Schema.String;
    }>>;
    readonly otherAssets: Schema.$Array<Schema.Struct<{
        readonly network: Schema.String;
        readonly assetAddress: Schema.String;
        readonly assetDecimals: Schema.Number;
        readonly netBase: Schema.String;
    }>>;
}>;
export type ReceivedContributor = typeof ReceivedContributor.Type;
export declare const ReceivedSums: Schema.Struct<{
    readonly usdMicro: Schema.String;
    readonly directMicro: Schema.String;
    readonly vaultUsdMicro: Schema.String;
    readonly directTransfers: Schema.Number;
    readonly vaultPayments: Schema.Number;
    readonly contributors: Schema.Number;
}>;
export type ReceivedSums = typeof ReceivedSums.Type;
export declare const ReceivedTotals: Schema.Struct<{
    readonly schemaVersion: Schema.Literal<"1">;
    readonly contributors: Schema.$Array<Schema.Struct<{
        readonly githubUserId: Schema.String;
        readonly login: Schema.Union<readonly [Schema.String, Schema.Null]>;
        readonly usdMicro: Schema.String;
        readonly directMicro: Schema.String;
        readonly vaultUsdMicro: Schema.String;
        readonly directTransfers: Schema.Number;
        readonly vaultPayments: Schema.Number;
        readonly projects: Schema.$Array<Schema.Struct<{
            readonly projectId: Schema.String;
            readonly usdMicro: Schema.String;
        }>>;
        readonly otherAssets: Schema.$Array<Schema.Struct<{
            readonly network: Schema.String;
            readonly assetAddress: Schema.String;
            readonly assetDecimals: Schema.Number;
            readonly netBase: Schema.String;
        }>>;
    }>>;
    readonly totals: Schema.Struct<{
        readonly usdMicro: Schema.String;
        readonly directMicro: Schema.String;
        readonly vaultUsdMicro: Schema.String;
        readonly directTransfers: Schema.Number;
        readonly vaultPayments: Schema.Number;
        readonly contributors: Schema.Number;
    }>;
    readonly generatedAt: Schema.String;
}>;
export type ReceivedTotals = typeof ReceivedTotals.Type;
export declare const AccountWallet: Schema.Struct<{
    readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
    readonly claimId: Schema.String;
    readonly address: Schema.String;
    readonly authorized: Schema.Boolean;
    readonly firstAuthorizedAt: Schema.Union<readonly [Schema.String, Schema.Null]>;
}>;
export type AccountWallet = typeof AccountWallet.Type;
export declare const DeliveryState: Schema.Literals<readonly ["needs_wallet", "ready", "submitted", "held", "paid"]>;
export type DeliveryState = typeof DeliveryState.Type;
export declare const AccountPayment: Schema.Struct<{
    readonly id: Schema.String;
    readonly vault: Schema.String;
    readonly projectId: Schema.String;
    readonly network: Schema.String;
    readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
    readonly assetAddress: Schema.String;
    readonly assetDecimals: Schema.Number;
    readonly grossBase: Schema.String;
    readonly feeBase: Schema.String;
    readonly state: Schema.Literals<readonly ["reserved", "paid"]>;
    readonly transactionId: Schema.Union<readonly [Schema.String, Schema.Null]>;
    readonly submittedTransactionId: Schema.Union<readonly [Schema.String, Schema.Null]>;
    readonly deliveryState: Schema.Literals<readonly ["needs_wallet", "ready", "submitted", "held", "paid"]>;
    readonly netBase: Schema.String;
}>;
export type AccountPayment = typeof AccountPayment.Type;
export declare const UnreservedAwardState: Schema.Literals<readonly ["underfunded", "awaiting-reservation", "conflict"]>;
export type UnreservedAwardState = typeof UnreservedAwardState.Type;
export declare const AccountMonthlyAward: Schema.Struct<{
    readonly projectId: Schema.String;
    readonly period: Schema.String;
    readonly network: Schema.String;
    readonly assetAddress: Schema.String;
    readonly assetDecimals: Schema.Number;
    readonly grossBase: Schema.String;
    readonly feeBase: Schema.String;
    readonly netBase: Schema.String;
    readonly state: Schema.Literals<readonly ["underfunded", "awaiting-reservation", "conflict"]>;
    readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
}>;
export type AccountMonthlyAward = typeof AccountMonthlyAward.Type;
export declare const AccountBalance: Schema.Struct<{
    readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
    readonly network: Schema.String;
    readonly assetAddress: Schema.String;
    readonly assetDecimals: Schema.Number;
    readonly netBase: Schema.String;
}>;
export type AccountBalance = typeof AccountBalance.Type;
export declare const WalletObservation: Schema.Struct<{
    readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
    readonly address: Schema.String;
    readonly proofLevel: Schema.Literal<"profile_readme">;
    readonly sourceUrl: Schema.String;
    readonly observedAt: Schema.String;
}>;
export type WalletObservation = typeof WalletObservation.Type;
export declare const PaymentsAccount: Schema.Struct<{
    readonly githubUserId: Schema.String;
    readonly wallets: Schema.$Array<Schema.Struct<{
        readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
        readonly claimId: Schema.String;
        readonly address: Schema.String;
        readonly authorized: Schema.Boolean;
        readonly firstAuthorizedAt: Schema.Union<readonly [Schema.String, Schema.Null]>;
    }>>;
    readonly payments: Schema.$Array<Schema.Struct<{
        readonly id: Schema.String;
        readonly vault: Schema.String;
        readonly projectId: Schema.String;
        readonly network: Schema.String;
        readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
        readonly assetAddress: Schema.String;
        readonly assetDecimals: Schema.Number;
        readonly grossBase: Schema.String;
        readonly feeBase: Schema.String;
        readonly state: Schema.Literals<readonly ["reserved", "paid"]>;
        readonly transactionId: Schema.Union<readonly [Schema.String, Schema.Null]>;
        readonly submittedTransactionId: Schema.Union<readonly [Schema.String, Schema.Null]>;
        readonly deliveryState: Schema.Literals<readonly ["needs_wallet", "ready", "submitted", "held", "paid"]>;
        readonly netBase: Schema.String;
    }>>;
    readonly monthlyAwards: Schema.$Array<Schema.Struct<{
        readonly projectId: Schema.String;
        readonly period: Schema.String;
        readonly network: Schema.String;
        readonly assetAddress: Schema.String;
        readonly assetDecimals: Schema.Number;
        readonly grossBase: Schema.String;
        readonly feeBase: Schema.String;
        readonly netBase: Schema.String;
        readonly state: Schema.Literals<readonly ["underfunded", "awaiting-reservation", "conflict"]>;
        readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
    }>>;
    readonly balances: Schema.$Array<Schema.Struct<{
        readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
        readonly network: Schema.String;
        readonly assetAddress: Schema.String;
        readonly assetDecimals: Schema.Number;
        readonly netBase: Schema.String;
    }>>;
    readonly directTransfers: Schema.$Array<Schema.Struct<{
        readonly projectId: Schema.String;
        readonly contributionMonth: Schema.String;
        readonly githubUserId: Schema.String;
        readonly login: Schema.String;
        readonly network: Schema.String;
        readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
        readonly recipient: Schema.String;
        readonly amountMicro: Schema.String;
        readonly transactionId: Schema.String;
        readonly blockTime: Schema.String;
    }>>;
    readonly directTransfersPaged: Schema.optional<Schema.Literal<true>>;
    readonly walletObservations: Schema.$Array<Schema.Struct<{
        readonly chain: Schema.Literals<readonly ["base", "solana", "robinhood", "ethereum"]>;
        readonly address: Schema.String;
        readonly proofLevel: Schema.Literal<"profile_readme">;
        readonly sourceUrl: Schema.String;
        readonly observedAt: Schema.String;
    }>>;
}>;
export type PaymentsAccount = typeof PaymentsAccount.Type;
export declare const MonthStart: Schema.Struct<{
    readonly period: Schema.String;
    readonly freeBalance: Schema.String;
    readonly totalGrossWithdrawn: Schema.String;
    readonly blockTime: Schema.String;
}>;
export type MonthStart = typeof MonthStart.Type;
export declare const FundedVault: Schema.Struct<{
    readonly network: Schema.String;
    readonly vault: Schema.String;
    readonly freeBalance: Schema.Union<readonly [Schema.String, Schema.Null]>;
    readonly totalGrossWithdrawn: Schema.String;
    readonly blockTime: Schema.String;
    readonly observedAt: Schema.String;
    readonly monthStarts: Schema.$Array<Schema.Struct<{
        readonly period: Schema.String;
        readonly freeBalance: Schema.String;
        readonly totalGrossWithdrawn: Schema.String;
        readonly blockTime: Schema.String;
    }>>;
}>;
export type FundedVault = typeof FundedVault.Type;
export declare const ProjectFunding: Schema.Struct<{
    readonly projectId: Schema.String;
    readonly vaults: Schema.$Array<Schema.Struct<{
        readonly network: Schema.String;
        readonly vault: Schema.String;
        readonly freeBalance: Schema.Union<readonly [Schema.String, Schema.Null]>;
        readonly totalGrossWithdrawn: Schema.String;
        readonly blockTime: Schema.String;
        readonly observedAt: Schema.String;
        readonly monthStarts: Schema.$Array<Schema.Struct<{
            readonly period: Schema.String;
            readonly freeBalance: Schema.String;
            readonly totalGrossWithdrawn: Schema.String;
            readonly blockTime: Schema.String;
        }>>;
    }>>;
}>;
export type ProjectFunding = typeof ProjectFunding.Type;
export declare const PoolFunding: Schema.Struct<{
    readonly schema: Schema.Literal<"slop-pool-funding-v1">;
    readonly projects: Schema.$Array<Schema.Struct<{
        readonly projectId: Schema.String;
        readonly vaults: Schema.$Array<Schema.Struct<{
            readonly network: Schema.String;
            readonly vault: Schema.String;
            readonly freeBalance: Schema.Union<readonly [Schema.String, Schema.Null]>;
            readonly totalGrossWithdrawn: Schema.String;
            readonly blockTime: Schema.String;
            readonly observedAt: Schema.String;
            readonly monthStarts: Schema.$Array<Schema.Struct<{
                readonly period: Schema.String;
                readonly freeBalance: Schema.String;
                readonly totalGrossWithdrawn: Schema.String;
                readonly blockTime: Schema.String;
            }>>;
        }>>;
    }>>;
}>;
export type PoolFunding = typeof PoolFunding.Type;
export declare const CycleFileReference: Schema.Struct<{
    readonly sha256: Schema.String;
    readonly url: Schema.String;
}>;
export type CycleFileReference = typeof CycleFileReference.Type;
export declare const CycleMoneyLine: Schema.Struct<{
    readonly suggestedMinor: Schema.String;
    readonly approvedMinor: Schema.String;
    readonly paidMinor: Schema.String;
}>;
export type CycleMoneyLine = typeof CycleMoneyLine.Type;
export declare const CycleMoneyLines: Schema.Struct<{
    readonly sharedPool: Schema.Struct<{
        readonly suggestedMinor: Schema.String;
        readonly approvedMinor: Schema.String;
        readonly paidMinor: Schema.String;
    }>;
    readonly reviewBudget: Schema.Struct<{
        readonly suggestedMinor: Schema.String;
        readonly approvedMinor: Schema.String;
        readonly paidMinor: Schema.String;
    }>;
}>;
export type CycleMoneyLines = typeof CycleMoneyLines.Type;
export declare const FundingBasis: Schema.Struct<{
    readonly cycleId: Schema.String;
    readonly instrumentId: Schema.Null;
    readonly fundingState: Schema.Literals<readonly ["committed", "pledged"]>;
    readonly committedMinor: Schema.String;
    readonly monthlyCapMinor: Schema.String;
}>;
export type FundingBasis = typeof FundingBasis.Type;
export declare const CycleReward: Schema.Struct<{
    readonly fundingBasis: Schema.optional<Schema.Struct<{
        readonly cycleId: Schema.String;
        readonly instrumentId: Schema.Null;
        readonly fundingState: Schema.Literals<readonly ["committed", "pledged"]>;
        readonly committedMinor: Schema.String;
        readonly monthlyCapMinor: Schema.String;
    }>>;
    readonly carriedMinor: Schema.optional<Schema.String>;
    readonly reviewBudgetCapMinor: Schema.optional<Schema.String>;
    readonly currency: Schema.Union<readonly [Schema.Literal<"USDC">, Schema.Null]>;
    readonly capMinor: Schema.String;
    readonly suggestedMinor: Schema.String;
    readonly approvedMinor: Schema.String;
    readonly paidMinor: Schema.String;
    readonly feeMinor: Schema.String;
    readonly sharePartsPerMillion: Schema.Union<readonly [Schema.Number, Schema.Null]>;
    readonly lines: Schema.optional<Schema.Struct<{
        readonly sharedPool: Schema.Struct<{
            readonly suggestedMinor: Schema.String;
            readonly approvedMinor: Schema.String;
            readonly paidMinor: Schema.String;
        }>;
        readonly reviewBudget: Schema.Struct<{
            readonly suggestedMinor: Schema.String;
            readonly approvedMinor: Schema.String;
            readonly paidMinor: Schema.String;
        }>;
    }>>;
}>;
export type CycleReward = typeof CycleReward.Type;
export declare const ReadmeWalletProof: Schema.Struct<{
    readonly address: Schema.String;
    readonly chain: Schema.Literals<readonly ["base", "solana"]>;
    readonly observedAt: Schema.String;
    readonly sourceCommit: Schema.String;
    readonly sourceUrl: Schema.String;
}>;
export type ReadmeWalletProof = typeof ReadmeWalletProof.Type;
export declare const ClaimWalletProof: Schema.Struct<{
    readonly address: Schema.String;
    readonly chain: Schema.Literals<readonly ["base", "solana"]>;
    readonly observedAt: Schema.String;
    readonly sourceActorId: Schema.String;
    readonly sourceClaimId: Schema.String;
    readonly sourceRecordSha256: Schema.String;
    readonly sourceUrl: Schema.String;
}>;
export type ClaimWalletProof = typeof ClaimWalletProof.Type;
export declare const IssueWalletProof: Schema.Struct<{
    readonly address: Schema.String;
    readonly chain: Schema.Literals<readonly ["base", "solana"]>;
    readonly observedAt: Schema.String;
    readonly sourceActorId: Schema.String;
    readonly sourceBodySha256: Schema.String;
    readonly sourceIssueId: Schema.String;
    readonly sourceIssueNumber: Schema.Number;
    readonly sourceUpdatedAt: Schema.String;
    readonly sourceUrl: Schema.String;
}>;
export type IssueWalletProof = typeof IssueWalletProof.Type;
export declare const CycleWalletProof: Schema.Union<readonly [Schema.Struct<{
    readonly address: Schema.String;
    readonly chain: Schema.Literals<readonly ["base", "solana"]>;
    readonly observedAt: Schema.String;
    readonly sourceCommit: Schema.String;
    readonly sourceUrl: Schema.String;
}>, Schema.Struct<{
    readonly address: Schema.String;
    readonly chain: Schema.Literals<readonly ["base", "solana"]>;
    readonly observedAt: Schema.String;
    readonly sourceActorId: Schema.String;
    readonly sourceClaimId: Schema.String;
    readonly sourceRecordSha256: Schema.String;
    readonly sourceUrl: Schema.String;
}>, Schema.Struct<{
    readonly address: Schema.String;
    readonly chain: Schema.Literals<readonly ["base", "solana"]>;
    readonly observedAt: Schema.String;
    readonly sourceActorId: Schema.String;
    readonly sourceBodySha256: Schema.String;
    readonly sourceIssueId: Schema.String;
    readonly sourceIssueNumber: Schema.Number;
    readonly sourceUpdatedAt: Schema.String;
    readonly sourceUrl: Schema.String;
}>]>;
export type CycleWalletProof = typeof CycleWalletProof.Type;
export declare const CycleActor: Schema.Struct<{
    readonly id: Schema.String;
    readonly login: Schema.String;
}>;
export type CycleActor = typeof CycleActor.Type;
export declare const CycleContributorState: Schema.Literals<readonly ["approved", "excluded", "held", "held-below-minimum", "proposed", "unclaimed", "external-share", "paid"]>;
export type CycleContributorState = typeof CycleContributorState.Type;
export declare const CycleContributor: Schema.Struct<{
    readonly actor: Schema.Struct<{
        readonly id: Schema.String;
        readonly login: Schema.String;
    }>;
    readonly score: Schema.Number;
    readonly scoreThirds: Schema.optional<Schema.Number>;
    readonly state: Schema.Literals<readonly ["approved", "excluded", "held", "held-below-minimum", "proposed", "unclaimed", "external-share", "paid"]>;
    readonly suggestedMinor: Schema.String;
    readonly approvedMinor: Schema.String;
    readonly paidMinor: Schema.String;
    readonly sharePartsPerMillion: Schema.Union<readonly [Schema.Number, Schema.Null]>;
    readonly wallet: Schema.Union<readonly [Schema.Union<readonly [Schema.Struct<{
        readonly address: Schema.String;
        readonly chain: Schema.Literals<readonly ["base", "solana"]>;
        readonly observedAt: Schema.String;
        readonly sourceCommit: Schema.String;
        readonly sourceUrl: Schema.String;
    }>, Schema.Struct<{
        readonly address: Schema.String;
        readonly chain: Schema.Literals<readonly ["base", "solana"]>;
        readonly observedAt: Schema.String;
        readonly sourceActorId: Schema.String;
        readonly sourceClaimId: Schema.String;
        readonly sourceRecordSha256: Schema.String;
        readonly sourceUrl: Schema.String;
    }>, Schema.Struct<{
        readonly address: Schema.String;
        readonly chain: Schema.Literals<readonly ["base", "solana"]>;
        readonly observedAt: Schema.String;
        readonly sourceActorId: Schema.String;
        readonly sourceBodySha256: Schema.String;
        readonly sourceIssueId: Schema.String;
        readonly sourceIssueNumber: Schema.Number;
        readonly sourceUpdatedAt: Schema.String;
        readonly sourceUrl: Schema.String;
    }>]>, Schema.Null]>;
    readonly lines: Schema.optional<Schema.Struct<{
        readonly sharedPool: Schema.Struct<{
            readonly suggestedMinor: Schema.String;
            readonly approvedMinor: Schema.String;
            readonly paidMinor: Schema.String;
        }>;
        readonly reviewBudget: Schema.Struct<{
            readonly suggestedMinor: Schema.String;
            readonly approvedMinor: Schema.String;
            readonly paidMinor: Schema.String;
        }>;
    }>>;
}>;
export type CycleContributor = typeof CycleContributor.Type;
export declare const CycleFiles: Schema.Struct<{
    readonly sourceSnapshot: Schema.Struct<{
        readonly sha256: Schema.String;
        readonly url: Schema.String;
    }>;
    readonly proposal: Schema.Struct<{
        readonly sha256: Schema.String;
        readonly url: Schema.String;
    }>;
    readonly allocation: Schema.Union<readonly [Schema.Struct<{
        readonly sha256: Schema.String;
        readonly url: Schema.String;
    }>, Schema.Null]>;
    readonly executionPlan: Schema.Union<readonly [Schema.Struct<{
        readonly sha256: Schema.String;
        readonly url: Schema.String;
    }>, Schema.Null]>;
    readonly settlement: Schema.Union<readonly [Schema.Struct<{
        readonly sha256: Schema.String;
        readonly url: Schema.String;
    }>, Schema.Null]>;
    readonly windup: Schema.Union<readonly [Schema.Struct<{
        readonly sha256: Schema.String;
        readonly url: Schema.String;
    }>, Schema.Null]>;
}>;
export type CycleFiles = typeof CycleFiles.Type;
export declare const CycleWindow: Schema.Struct<{
    readonly from: Schema.String;
    readonly to: Schema.String;
}>;
export type CycleWindow = typeof CycleWindow.Type;
export declare const CycleState: Schema.Literals<readonly ["closed-no-awards", "external-provisional", "paid", "payment-ready", "review", "settlement-planned", "wound-up"]>;
export type CycleState = typeof CycleState.Type;
export declare const CycleIndexEntry: Schema.Struct<{
    readonly projectId: Schema.String;
    readonly cycleId: Schema.String;
    readonly kind: Schema.Literals<readonly ["external-prize-share", "monthly-pool"]>;
    readonly state: Schema.Literals<readonly ["closed-no-awards", "external-provisional", "paid", "payment-ready", "review", "settlement-planned", "wound-up"]>;
    readonly generatedAt: Schema.String;
    readonly contributionWindow: Schema.Struct<{
        readonly from: Schema.String;
        readonly to: Schema.String;
    }>;
    readonly reviewEndsAt: Schema.Union<readonly [Schema.String, Schema.Null]>;
    readonly approvedAt: Schema.Union<readonly [Schema.String, Schema.Null]>;
    readonly settledAt: Schema.Union<readonly [Schema.String, Schema.Null]>;
    readonly reward: Schema.Struct<{
        readonly fundingBasis: Schema.optional<Schema.Struct<{
            readonly cycleId: Schema.String;
            readonly instrumentId: Schema.Null;
            readonly fundingState: Schema.Literals<readonly ["committed", "pledged"]>;
            readonly committedMinor: Schema.String;
            readonly monthlyCapMinor: Schema.String;
        }>>;
        readonly carriedMinor: Schema.optional<Schema.String>;
        readonly reviewBudgetCapMinor: Schema.optional<Schema.String>;
        readonly currency: Schema.Union<readonly [Schema.Literal<"USDC">, Schema.Null]>;
        readonly capMinor: Schema.String;
        readonly suggestedMinor: Schema.String;
        readonly approvedMinor: Schema.String;
        readonly paidMinor: Schema.String;
        readonly feeMinor: Schema.String;
        readonly sharePartsPerMillion: Schema.Union<readonly [Schema.Number, Schema.Null]>;
        readonly lines: Schema.optional<Schema.Struct<{
            readonly sharedPool: Schema.Struct<{
                readonly suggestedMinor: Schema.String;
                readonly approvedMinor: Schema.String;
                readonly paidMinor: Schema.String;
            }>;
            readonly reviewBudget: Schema.Struct<{
                readonly suggestedMinor: Schema.String;
                readonly approvedMinor: Schema.String;
                readonly paidMinor: Schema.String;
            }>;
        }>>;
    }>;
    readonly contributors: Schema.$Array<Schema.Struct<{
        readonly actor: Schema.Struct<{
            readonly id: Schema.String;
            readonly login: Schema.String;
        }>;
        readonly score: Schema.Number;
        readonly scoreThirds: Schema.optional<Schema.Number>;
        readonly state: Schema.Literals<readonly ["approved", "excluded", "held", "held-below-minimum", "proposed", "unclaimed", "external-share", "paid"]>;
        readonly suggestedMinor: Schema.String;
        readonly approvedMinor: Schema.String;
        readonly paidMinor: Schema.String;
        readonly sharePartsPerMillion: Schema.Union<readonly [Schema.Number, Schema.Null]>;
        readonly wallet: Schema.Union<readonly [Schema.Union<readonly [Schema.Struct<{
            readonly address: Schema.String;
            readonly chain: Schema.Literals<readonly ["base", "solana"]>;
            readonly observedAt: Schema.String;
            readonly sourceCommit: Schema.String;
            readonly sourceUrl: Schema.String;
        }>, Schema.Struct<{
            readonly address: Schema.String;
            readonly chain: Schema.Literals<readonly ["base", "solana"]>;
            readonly observedAt: Schema.String;
            readonly sourceActorId: Schema.String;
            readonly sourceClaimId: Schema.String;
            readonly sourceRecordSha256: Schema.String;
            readonly sourceUrl: Schema.String;
        }>, Schema.Struct<{
            readonly address: Schema.String;
            readonly chain: Schema.Literals<readonly ["base", "solana"]>;
            readonly observedAt: Schema.String;
            readonly sourceActorId: Schema.String;
            readonly sourceBodySha256: Schema.String;
            readonly sourceIssueId: Schema.String;
            readonly sourceIssueNumber: Schema.Number;
            readonly sourceUpdatedAt: Schema.String;
            readonly sourceUrl: Schema.String;
        }>]>, Schema.Null]>;
        readonly lines: Schema.optional<Schema.Struct<{
            readonly sharedPool: Schema.Struct<{
                readonly suggestedMinor: Schema.String;
                readonly approvedMinor: Schema.String;
                readonly paidMinor: Schema.String;
            }>;
            readonly reviewBudget: Schema.Struct<{
                readonly suggestedMinor: Schema.String;
                readonly approvedMinor: Schema.String;
                readonly paidMinor: Schema.String;
            }>;
        }>>;
    }>>;
    readonly files: Schema.Struct<{
        readonly sourceSnapshot: Schema.Struct<{
            readonly sha256: Schema.String;
            readonly url: Schema.String;
        }>;
        readonly proposal: Schema.Struct<{
            readonly sha256: Schema.String;
            readonly url: Schema.String;
        }>;
        readonly allocation: Schema.Union<readonly [Schema.Struct<{
            readonly sha256: Schema.String;
            readonly url: Schema.String;
        }>, Schema.Null]>;
        readonly executionPlan: Schema.Union<readonly [Schema.Struct<{
            readonly sha256: Schema.String;
            readonly url: Schema.String;
        }>, Schema.Null]>;
        readonly settlement: Schema.Union<readonly [Schema.Struct<{
            readonly sha256: Schema.String;
            readonly url: Schema.String;
        }>, Schema.Null]>;
        readonly windup: Schema.Union<readonly [Schema.Struct<{
            readonly sha256: Schema.String;
            readonly url: Schema.String;
        }>, Schema.Null]>;
    }>;
}>;
export type CycleIndexEntry = typeof CycleIndexEntry.Type;
export declare const CycleIndex: Schema.Struct<{
    readonly schemaVersion: Schema.Literal<"1">;
    readonly generatedAt: Schema.String;
    readonly cycles: Schema.$Array<Schema.Struct<{
        readonly projectId: Schema.String;
        readonly cycleId: Schema.String;
        readonly kind: Schema.Literals<readonly ["external-prize-share", "monthly-pool"]>;
        readonly state: Schema.Literals<readonly ["closed-no-awards", "external-provisional", "paid", "payment-ready", "review", "settlement-planned", "wound-up"]>;
        readonly generatedAt: Schema.String;
        readonly contributionWindow: Schema.Struct<{
            readonly from: Schema.String;
            readonly to: Schema.String;
        }>;
        readonly reviewEndsAt: Schema.Union<readonly [Schema.String, Schema.Null]>;
        readonly approvedAt: Schema.Union<readonly [Schema.String, Schema.Null]>;
        readonly settledAt: Schema.Union<readonly [Schema.String, Schema.Null]>;
        readonly reward: Schema.Struct<{
            readonly fundingBasis: Schema.optional<Schema.Struct<{
                readonly cycleId: Schema.String;
                readonly instrumentId: Schema.Null;
                readonly fundingState: Schema.Literals<readonly ["committed", "pledged"]>;
                readonly committedMinor: Schema.String;
                readonly monthlyCapMinor: Schema.String;
            }>>;
            readonly carriedMinor: Schema.optional<Schema.String>;
            readonly reviewBudgetCapMinor: Schema.optional<Schema.String>;
            readonly currency: Schema.Union<readonly [Schema.Literal<"USDC">, Schema.Null]>;
            readonly capMinor: Schema.String;
            readonly suggestedMinor: Schema.String;
            readonly approvedMinor: Schema.String;
            readonly paidMinor: Schema.String;
            readonly feeMinor: Schema.String;
            readonly sharePartsPerMillion: Schema.Union<readonly [Schema.Number, Schema.Null]>;
            readonly lines: Schema.optional<Schema.Struct<{
                readonly sharedPool: Schema.Struct<{
                    readonly suggestedMinor: Schema.String;
                    readonly approvedMinor: Schema.String;
                    readonly paidMinor: Schema.String;
                }>;
                readonly reviewBudget: Schema.Struct<{
                    readonly suggestedMinor: Schema.String;
                    readonly approvedMinor: Schema.String;
                    readonly paidMinor: Schema.String;
                }>;
            }>>;
        }>;
        readonly contributors: Schema.$Array<Schema.Struct<{
            readonly actor: Schema.Struct<{
                readonly id: Schema.String;
                readonly login: Schema.String;
            }>;
            readonly score: Schema.Number;
            readonly scoreThirds: Schema.optional<Schema.Number>;
            readonly state: Schema.Literals<readonly ["approved", "excluded", "held", "held-below-minimum", "proposed", "unclaimed", "external-share", "paid"]>;
            readonly suggestedMinor: Schema.String;
            readonly approvedMinor: Schema.String;
            readonly paidMinor: Schema.String;
            readonly sharePartsPerMillion: Schema.Union<readonly [Schema.Number, Schema.Null]>;
            readonly wallet: Schema.Union<readonly [Schema.Union<readonly [Schema.Struct<{
                readonly address: Schema.String;
                readonly chain: Schema.Literals<readonly ["base", "solana"]>;
                readonly observedAt: Schema.String;
                readonly sourceCommit: Schema.String;
                readonly sourceUrl: Schema.String;
            }>, Schema.Struct<{
                readonly address: Schema.String;
                readonly chain: Schema.Literals<readonly ["base", "solana"]>;
                readonly observedAt: Schema.String;
                readonly sourceActorId: Schema.String;
                readonly sourceClaimId: Schema.String;
                readonly sourceRecordSha256: Schema.String;
                readonly sourceUrl: Schema.String;
            }>, Schema.Struct<{
                readonly address: Schema.String;
                readonly chain: Schema.Literals<readonly ["base", "solana"]>;
                readonly observedAt: Schema.String;
                readonly sourceActorId: Schema.String;
                readonly sourceBodySha256: Schema.String;
                readonly sourceIssueId: Schema.String;
                readonly sourceIssueNumber: Schema.Number;
                readonly sourceUpdatedAt: Schema.String;
                readonly sourceUrl: Schema.String;
            }>]>, Schema.Null]>;
            readonly lines: Schema.optional<Schema.Struct<{
                readonly sharedPool: Schema.Struct<{
                    readonly suggestedMinor: Schema.String;
                    readonly approvedMinor: Schema.String;
                    readonly paidMinor: Schema.String;
                }>;
                readonly reviewBudget: Schema.Struct<{
                    readonly suggestedMinor: Schema.String;
                    readonly approvedMinor: Schema.String;
                    readonly paidMinor: Schema.String;
                }>;
            }>>;
        }>>;
        readonly files: Schema.Struct<{
            readonly sourceSnapshot: Schema.Struct<{
                readonly sha256: Schema.String;
                readonly url: Schema.String;
            }>;
            readonly proposal: Schema.Struct<{
                readonly sha256: Schema.String;
                readonly url: Schema.String;
            }>;
            readonly allocation: Schema.Union<readonly [Schema.Struct<{
                readonly sha256: Schema.String;
                readonly url: Schema.String;
            }>, Schema.Null]>;
            readonly executionPlan: Schema.Union<readonly [Schema.Struct<{
                readonly sha256: Schema.String;
                readonly url: Schema.String;
            }>, Schema.Null]>;
            readonly settlement: Schema.Union<readonly [Schema.Struct<{
                readonly sha256: Schema.String;
                readonly url: Schema.String;
            }>, Schema.Null]>;
            readonly windup: Schema.Union<readonly [Schema.Struct<{
                readonly sha256: Schema.String;
                readonly url: Schema.String;
            }>, Schema.Null]>;
        }>;
    }>>;
}>;
export type CycleIndex = typeof CycleIndex.Type;
export declare const cycleIndexUrl = "/data/cycles/index.json";
export declare const paymentsMe: import("@repo/platform/route").Route<undefined, {
    readonly githubUserId: string;
    readonly wallets: readonly {
        readonly chain: "base" | "ethereum" | "robinhood" | "solana";
        readonly claimId: string;
        readonly address: string;
        readonly authorized: boolean;
        readonly firstAuthorizedAt: string | null;
    }[];
    readonly payments: readonly {
        readonly id: string;
        readonly vault: string;
        readonly projectId: string;
        readonly network: string;
        readonly chain: "base" | "ethereum" | "robinhood" | "solana";
        readonly assetAddress: string;
        readonly assetDecimals: number;
        readonly grossBase: string;
        readonly feeBase: string;
        readonly state: "paid" | "reserved";
        readonly transactionId: string | null;
        readonly submittedTransactionId: string | null;
        readonly deliveryState: "held" | "needs_wallet" | "paid" | "ready" | "submitted";
        readonly netBase: string;
    }[];
    readonly monthlyAwards: readonly {
        readonly projectId: string;
        readonly period: string;
        readonly network: string;
        readonly assetAddress: string;
        readonly assetDecimals: number;
        readonly grossBase: string;
        readonly feeBase: string;
        readonly netBase: string;
        readonly state: "awaiting-reservation" | "conflict" | "underfunded";
        readonly chain: "base" | "ethereum" | "robinhood" | "solana";
    }[];
    readonly balances: readonly {
        readonly chain: "base" | "ethereum" | "robinhood" | "solana";
        readonly network: string;
        readonly assetAddress: string;
        readonly assetDecimals: number;
        readonly netBase: string;
    }[];
    readonly directTransfers: readonly {
        readonly projectId: string;
        readonly contributionMonth: string;
        readonly githubUserId: string;
        readonly login: string;
        readonly network: string;
        readonly chain: "base" | "ethereum" | "robinhood" | "solana";
        readonly recipient: string;
        readonly amountMicro: string;
        readonly transactionId: string;
        readonly blockTime: string;
    }[];
    readonly directTransfersPaged?: true | undefined;
    readonly walletObservations: readonly {
        readonly chain: "base" | "ethereum" | "robinhood" | "solana";
        readonly address: string;
        readonly proofLevel: "profile_readme";
        readonly sourceUrl: string;
        readonly observedAt: string;
    }[];
}, "session">;
export declare const receivedTotals: import("@repo/platform/route").Route<undefined, {
    readonly schemaVersion: "1";
    readonly contributors: readonly {
        readonly githubUserId: string;
        readonly login: string | null;
        readonly usdMicro: string;
        readonly directMicro: string;
        readonly vaultUsdMicro: string;
        readonly directTransfers: number;
        readonly vaultPayments: number;
        readonly projects: readonly {
            readonly projectId: string;
            readonly usdMicro: string;
        }[];
        readonly otherAssets: readonly {
            readonly network: string;
            readonly assetAddress: string;
            readonly assetDecimals: number;
            readonly netBase: string;
        }[];
    }[];
    readonly totals: {
        readonly usdMicro: string;
        readonly directMicro: string;
        readonly vaultUsdMicro: string;
        readonly directTransfers: number;
        readonly vaultPayments: number;
        readonly contributors: number;
    };
    readonly generatedAt: string;
}, "public">;
export declare const vaultPayments: import("@repo/platform/route").Route<undefined, {
    readonly payments: readonly {
        readonly id: string;
        readonly projectId: string;
        readonly network: string;
        readonly chain: "base" | "ethereum" | "robinhood" | "solana";
        readonly contributionMonth: string | null;
        readonly assetAddress: string;
        readonly assetDecimals: number;
        readonly netBase: string;
        readonly transactionId: string;
        readonly indexedAt: string;
    }[];
    readonly through: number;
    readonly next: number | null;
    readonly total: number;
}, "public">;
export declare const projectVaultPayments: import("@repo/platform/route").Route<undefined, {
    readonly payments: readonly {
        readonly id: string;
        readonly projectId: string;
        readonly network: string;
        readonly chain: "base" | "ethereum" | "robinhood" | "solana";
        readonly contributionMonth: string | null;
        readonly assetAddress: string;
        readonly assetDecimals: number;
        readonly netBase: string;
        readonly transactionId: string;
        readonly indexedAt: string;
    }[];
    readonly through: number;
    readonly next: number | null;
    readonly total: number;
}, "public">;
export declare const actorVaultPayments: import("@repo/platform/route").Route<undefined, {
    readonly payments: readonly {
        readonly id: string;
        readonly projectId: string;
        readonly network: string;
        readonly chain: "base" | "ethereum" | "robinhood" | "solana";
        readonly contributionMonth: string | null;
        readonly assetAddress: string;
        readonly assetDecimals: number;
        readonly netBase: string;
        readonly transactionId: string;
        readonly indexedAt: string;
    }[];
    readonly through: number;
    readonly next: number | null;
    readonly total: number;
}, "public">;
export declare const projectDirectTransfers: import("@repo/platform/route").Route<undefined, {
    readonly transfers: readonly {
        readonly projectId: string;
        readonly contributionMonth: string;
        readonly githubUserId: string;
        readonly login: string;
        readonly network: string;
        readonly chain: "base" | "ethereum" | "robinhood" | "solana";
        readonly recipient: string;
        readonly amountMicro: string;
        readonly transactionId: string;
        readonly blockTime: string;
    }[];
    readonly totalMicro: string;
    readonly through: number;
    readonly next: number | null;
    readonly total: number;
} | {
    readonly transfers: readonly {
        readonly projectId: string;
        readonly contributionMonth: string;
        readonly githubUserId: string;
        readonly login: string;
        readonly network: string;
        readonly chain: "base" | "ethereum" | "robinhood" | "solana";
        readonly recipient: string;
        readonly amountMicro: string;
        readonly transactionId: string;
        readonly blockTime: string;
    }[];
    readonly totalMicro: string;
}, "public">;
export declare const actorDirectTransfers: import("@repo/platform/route").Route<undefined, {
    readonly transfers: readonly {
        readonly projectId: string;
        readonly contributionMonth: string;
        readonly githubUserId: string;
        readonly login: string;
        readonly network: string;
        readonly chain: "base" | "ethereum" | "robinhood" | "solana";
        readonly recipient: string;
        readonly amountMicro: string;
        readonly transactionId: string;
        readonly blockTime: string;
    }[];
    readonly totalMicro: string;
    readonly through: number;
    readonly next: number | null;
    readonly total: number;
} | {
    readonly transfers: readonly {
        readonly projectId: string;
        readonly contributionMonth: string;
        readonly githubUserId: string;
        readonly login: string;
        readonly network: string;
        readonly chain: "base" | "ethereum" | "robinhood" | "solana";
        readonly recipient: string;
        readonly amountMicro: string;
        readonly transactionId: string;
        readonly blockTime: string;
    }[];
    readonly totalMicro: string;
}, "public">;
export declare const poolFunding: import("@repo/platform/route").Route<undefined, {
    readonly schema: "slop-pool-funding-v1";
    readonly projects: readonly {
        readonly projectId: string;
        readonly vaults: readonly {
            readonly network: string;
            readonly vault: string;
            readonly freeBalance: string | null;
            readonly totalGrossWithdrawn: string;
            readonly blockTime: string;
            readonly observedAt: string;
            readonly monthStarts: readonly {
                readonly period: string;
                readonly freeBalance: string;
                readonly totalGrossWithdrawn: string;
                readonly blockTime: string;
            }[];
        }[];
    }[];
}, "public">;
export declare const directHistoryHeader = "x-slop-direct-history";
export declare const publicApi: ReadonlyArray<AnyRoute>;
