import { Schema } from "effect";
export declare const PaymentWallet: Schema.Struct<{
    readonly id: Schema.String;
    readonly address: Schema.String;
    readonly digest: Schema.String;
}>;
export type PaymentWallet = typeof PaymentWallet.Type;
export declare const PaymentAsset: Schema.Struct<{
    readonly address: Schema.String;
    readonly decimals: Schema.Number;
    readonly symbol: Schema.String;
}>;
export type PaymentAsset = typeof PaymentAsset.Type;
export declare const PaymentTransfer: Schema.Struct<{
    readonly recipient: Schema.String;
    readonly amountBase: Schema.String;
}>;
export type PaymentTransfer = typeof PaymentTransfer.Type;
export declare const PaymentTransaction: Schema.Struct<{
    readonly chainId: Schema.String;
    readonly from: Schema.String;
    readonly nonce: Schema.optional<Schema.String>;
    readonly to: Schema.String;
    readonly value: Schema.String;
    readonly data: Schema.String;
}>;
export type PaymentTransaction = typeof PaymentTransaction.Type;
export declare const SolanaPlan: Schema.Struct<{
    readonly transaction: Schema.String;
}>;
export type SolanaPlan = typeof SolanaPlan.Type;
export declare const DirectIntent: Schema.Struct<{
    readonly protocolVersion: Schema.optional<Schema.Number>;
    readonly preparedAt: Schema.String;
    readonly afterBlock: Schema.String;
    readonly afterBlocks: Schema.optional<Schema.$Array<Schema.String>>;
    readonly rail: Schema.Literal<"direct">;
    readonly network: Schema.String;
    readonly chain: Schema.String;
    readonly asset: Schema.Struct<{
        readonly address: Schema.String;
        readonly decimals: Schema.Number;
        readonly symbol: Schema.String;
    }>;
    readonly payer: Schema.Struct<{
        readonly id: Schema.String;
        readonly address: Schema.String;
        readonly digest: Schema.String;
    }>;
    readonly recipient: Schema.Struct<{
        readonly id: Schema.String;
        readonly address: Schema.String;
        readonly digest: Schema.String;
    }>;
    readonly grossBase: Schema.String;
    readonly feeBase: Schema.String;
    readonly netBase: Schema.String;
    readonly transfers: Schema.$Array<Schema.Struct<{
        readonly recipient: Schema.String;
        readonly amountBase: Schema.String;
    }>>;
    readonly transactions: Schema.optional<Schema.$Array<Schema.Struct<{
        readonly chainId: Schema.String;
        readonly from: Schema.String;
        readonly nonce: Schema.optional<Schema.String>;
        readonly to: Schema.String;
        readonly value: Schema.String;
        readonly data: Schema.String;
    }>>>;
    readonly solana: Schema.optional<Schema.Struct<{
        readonly transaction: Schema.String;
    }>>;
    readonly payerGithubId: Schema.optional<Schema.String>;
}>;
export type DirectIntent = typeof DirectIntent.Type;
export declare const RemainingTransfer: Schema.Struct<{
    readonly recipient: Schema.String;
    readonly amountBase: Schema.String;
    readonly role: Schema.Literals<readonly ["researcher", "fee"]>;
}>;
export type RemainingTransfer = typeof RemainingTransfer.Type;
export declare const OwnerRequest: Schema.Struct<{
    readonly protocolVersion: Schema.optional<Schema.Number>;
    readonly preparedAt: Schema.String;
    readonly afterBlock: Schema.String;
    readonly afterBlocks: Schema.optional<Schema.$Array<Schema.String>>;
    readonly rail: Schema.Literal<"direct">;
    readonly network: Schema.String;
    readonly chain: Schema.String;
    readonly asset: Schema.Struct<{
        readonly address: Schema.String;
        readonly decimals: Schema.Number;
        readonly symbol: Schema.String;
    }>;
    readonly payer: Schema.Struct<{
        readonly id: Schema.String;
        readonly address: Schema.String;
        readonly digest: Schema.String;
    }>;
    readonly recipient: Schema.Struct<{
        readonly id: Schema.String;
        readonly address: Schema.String;
        readonly digest: Schema.String;
    }>;
    readonly grossBase: Schema.String;
    readonly feeBase: Schema.String;
    readonly netBase: Schema.String;
    readonly transfers: Schema.$Array<Schema.Struct<{
        readonly recipient: Schema.String;
        readonly amountBase: Schema.String;
        readonly role: Schema.Literals<readonly ["researcher", "fee"]>;
    }>>;
    readonly transactions: Schema.optional<Schema.$Array<Schema.Struct<{
        readonly chainId: Schema.String;
        readonly from: Schema.String;
        readonly nonce: Schema.optional<Schema.String>;
        readonly to: Schema.String;
        readonly value: Schema.String;
        readonly data: Schema.String;
    }>>>;
    readonly solana: Schema.optional<Schema.Struct<{
        readonly transaction: Schema.String;
    }>>;
    readonly payerGithubId: Schema.optional<Schema.String>;
}>;
export type OwnerRequest = typeof OwnerRequest.Type;
export declare const DirectSettlementView: Schema.Struct<{
    readonly rail: Schema.Literal<"direct">;
    readonly state: Schema.Literals<readonly ["paid", "awaiting-external-payment"]>;
    readonly network: Schema.String;
    readonly generation: Schema.Number;
    readonly asset: Schema.String;
    readonly grossBase: Schema.String;
    readonly feeBase: Schema.String;
    readonly netBase: Schema.String;
    readonly transactionIds: Schema.$Array<Schema.String>;
    readonly confirmedTransactionIds: Schema.$Array<Schema.String>;
    readonly remainingTransfers: Schema.$Array<Schema.Struct<{
        readonly recipient: Schema.String;
        readonly amountBase: Schema.String;
        readonly role: Schema.Literals<readonly ["researcher", "fee"]>;
    }>>;
    readonly transactionId: Schema.Union<readonly [Schema.String, Schema.Null]>;
    readonly submittedTransactionId: Schema.Null;
    readonly walletReviewRequired: Schema.Boolean;
    readonly privacyNotice: Schema.String;
    readonly ownerRequest: Schema.Union<readonly [Schema.Struct<{
        readonly protocolVersion: Schema.optional<Schema.Number>;
        readonly preparedAt: Schema.String;
        readonly afterBlock: Schema.String;
        readonly afterBlocks: Schema.optional<Schema.$Array<Schema.String>>;
        readonly rail: Schema.Literal<"direct">;
        readonly network: Schema.String;
        readonly chain: Schema.String;
        readonly asset: Schema.Struct<{
            readonly address: Schema.String;
            readonly decimals: Schema.Number;
            readonly symbol: Schema.String;
        }>;
        readonly payer: Schema.Struct<{
            readonly id: Schema.String;
            readonly address: Schema.String;
            readonly digest: Schema.String;
        }>;
        readonly recipient: Schema.Struct<{
            readonly id: Schema.String;
            readonly address: Schema.String;
            readonly digest: Schema.String;
        }>;
        readonly grossBase: Schema.String;
        readonly feeBase: Schema.String;
        readonly netBase: Schema.String;
        readonly transfers: Schema.$Array<Schema.Struct<{
            readonly recipient: Schema.String;
            readonly amountBase: Schema.String;
            readonly role: Schema.Literals<readonly ["researcher", "fee"]>;
        }>>;
        readonly transactions: Schema.optional<Schema.$Array<Schema.Struct<{
            readonly chainId: Schema.String;
            readonly from: Schema.String;
            readonly nonce: Schema.optional<Schema.String>;
            readonly to: Schema.String;
            readonly value: Schema.String;
            readonly data: Schema.String;
        }>>>;
        readonly solana: Schema.optional<Schema.Struct<{
            readonly transaction: Schema.String;
        }>>;
        readonly payerGithubId: Schema.optional<Schema.String>;
    }>, Schema.Null]>;
}>;
export type DirectSettlementView = typeof DirectSettlementView.Type;
export declare const ConsentPaymentBody: Schema.Struct<{
    readonly network: Schema.String;
    readonly confirmation: Schema.Boolean;
}>;
export type ConsentPaymentBody = typeof ConsentPaymentBody.Type;
export declare const PreparePaymentBody: Schema.Struct<{
    readonly network: Schema.String;
    readonly confirmation: Schema.Boolean;
}>;
export type PreparePaymentBody = typeof PreparePaymentBody.Type;
export declare const VerifyPaymentBody: Schema.Struct<{
    readonly transactionIds: Schema.$Array<Schema.String>;
    readonly confirmation: Schema.Boolean;
}>;
export type VerifyPaymentBody = typeof VerifyPaymentBody.Type;
export declare const ConsentDetail: Schema.Struct<{
    readonly network: Schema.String;
    readonly publicChainVisibilityAccepted: Schema.Literal<true>;
}>;
export type ConsentDetail = typeof ConsentDetail.Type;
export declare const PrepareDetail: Schema.Struct<{
    readonly network: Schema.String;
    readonly rail: Schema.Literal<"direct">;
    readonly refreshed: Schema.optional<Schema.Literal<true>>;
}>;
export type PrepareDetail = typeof PrepareDetail.Type;
export declare const VerifyDetail: Schema.Struct<{
    readonly verified: Schema.Literal<true>;
    readonly rail: Schema.Literal<"direct">;
}>;
export type VerifyDetail = typeof VerifyDetail.Type;
export type DirectRefusal = "confirmationRequiredAcceptPublicChainVisibility" | "confirmationRequiredConfirmTheExact75" | "invalidRequestConfirmOneOrTwo" | "invalidRequestUseThePaymentS" | "forbiddenOnlyTheReporterMay" | "railUnavailable" | "railUnavailableTheProgramHasNo" | "railUnavailableTheBountyVaultPays" | "railUnavailableDirectPaymentIsUnavailable" | "railUnavailableReceiptVerificationIsUnavailable" | "paymentWalletRequiredConfirmAPayoutWallet" | "paymentWalletConflict" | "paymentWalletConflictPayerReporterAndPlatform" | "paymentConsentRequired" | "paymentProofUnavailable" | "paymentNonceUnavailable" | "paymentNotPending" | "paymentWalletChanged" | "paymentNetworkChanged" | "paymentAlreadyVerified" | "paymentNotPreparedPrepareTheExactPayment" | "paymentAlreadyVerifiedThisPaymentIsAlready" | "paymentUnverified" | "paymentReplay" | "paymentReplayThisTransferIsAlready" | "paymentLegAlreadyVerified" | "paymentPreparationChanged" | "staleRevision";
