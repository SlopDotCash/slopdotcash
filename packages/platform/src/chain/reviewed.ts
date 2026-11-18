// spec/settlement/signer.md, "A signer stack signs only for its own networks, and production signs only enabled mainnets as the attester"; spec/settlement/vaultSnapshots.md, "Only a reviewed registry binding can obtain totals"

export type EvmAddress = `0x${string}` & { readonly __brand: "EvmAddress" };

export type ReviewedEvmNetwork = "base-mainnet" | "ethereum" | "robinhood-mainnet";

export type ReviewedSolanaNetwork = "solana-mainnet";

export type MainnetNetwork = ReviewedEvmNetwork | ReviewedSolanaNetwork;

export interface ImplementationReview {
  readonly authority: EvmAddress;
  readonly vaultImplementation: EvmAddress;
  readonly vaultImplementationCodeSha256: string;
  readonly factoryImplementation: EvmAddress;
  readonly factoryImplementationCodeSha256: string;
}

export interface ReviewedFactory {
  readonly network: ReviewedEvmNetwork;
  readonly sourceCommit: string;
  readonly codeSha256: string;
  readonly bindingDelaySeconds: bigint;
  readonly identityAuthority: EvmAddress;
  readonly feeRecipient: EvmAddress;
  readonly factory: EvmAddress;
  readonly factoryCodeSha256: string;
  readonly registrar: EvmAddress;
  readonly upgrade: ImplementationReview;
}

export interface ReviewedSolanaProgram {
  readonly network: ReviewedSolanaNetwork;
  readonly sourceCommit: string;
  readonly programId: string;
  readonly codeSha256: string;
  readonly upgradeAuthority: string;
  readonly identityAuthority: string;
  readonly feeRecipient: string;
  readonly rotationAuthority: string;
  readonly networkDomain: string;
  readonly bindingDelaySeconds: bigint;
  readonly rotationDelaySeconds: bigint;
}

const SOURCE_COMMIT = "7fdedd3507c3f79217ccc896ace0e0b7472ca092";
const PROXY_CODE_SHA256 = "afb62459ccdd87d344b8bfa367c8dc49586323316bb8a51f1dfbe753336c0509";

const MONTHLY_RESERVE_V2: ImplementationReview = {
  authority: "0x2ad20afa352ec70e43a6d0e7794cf305c9cbe35d" as EvmAddress,
  vaultImplementation: "0x90c46e3e5be35b1048cd69403d1402feed1240d8" as EvmAddress,
  vaultImplementationCodeSha256: "155c7ea2fdeeaeccfd6daac64b6105e968c1927092f8761f34090a8b42e15bfc",
  factoryImplementation: "0x9f27aec70559d8f4ca1a62398e673a25b1ce3e2f" as EvmAddress,
  factoryImplementationCodeSha256: "976208154ce5e58f59d826e58273d917adc226109bf95ab4894b9cf144e4a1dd",
};

const REVIEWED_DEPLOYMENT = {
  sourceCommit: SOURCE_COMMIT,
  codeSha256: PROXY_CODE_SHA256,
  bindingDelaySeconds: 0n,
  identityAuthority: "0x31b87d13f9091bc3b8a5cb6f45c8b3cb99ed6d70" as EvmAddress,
  feeRecipient: "0x8f77c37d8650776bfe73c9b12b15209ee15d9b86" as EvmAddress,
  factory: "0xe51abf8c6dbb3ca6e9ad09f2dc6ef141d7364aab" as EvmAddress,
  factoryCodeSha256: PROXY_CODE_SHA256,
  registrar: "0xd64f35ac87d9a1fb8ebd44e745c24436b606cf60" as EvmAddress,
  upgrade: MONTHLY_RESERVE_V2,
} satisfies Omit<ReviewedFactory, "network">;

export const REVIEWED_FACTORIES: ReadonlyArray<ReviewedFactory> = [
  { network: "base-mainnet", ...REVIEWED_DEPLOYMENT },
  { network: "ethereum", ...REVIEWED_DEPLOYMENT },
  { network: "robinhood-mainnet", ...REVIEWED_DEPLOYMENT },
];

export const REVIEWED_SOLANA_PROGRAMS: ReadonlyArray<ReviewedSolanaProgram> = [
  {
    network: "solana-mainnet",
    sourceCommit: "c9564479a65523756fd2998e04d192be3f88579a",
    programId: "7E5ZRh5y6Xgg7k3kdS75CMiTE2efoq9PqNWR5fCVDavQ",
    codeSha256: "f250228d87493c024737de9dea4290ed0d28ed777eaddf17b874d493b77274a6",
    upgradeAuthority: "EmMRRFhjZmr2SN5RdhV98WPnUhgJxKMoE1itSwUsU8tr",
    identityAuthority: "Eq6tYrPnkhj3hLmSZUL9xUWjkZ3Y5j3naBAJyQyKMYzS",
    feeRecipient: "9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY",
    rotationAuthority: "2tAA47aavW2mqtCAxbn21ZqLb8xZTeq8XvkRR9emduiy",
    networkDomain: "9153d7c5242e94d5db756dc24bb60b5eca792c7bc7b9e847c05c9ce004b66a8f",
    bindingDelaySeconds: 0n,
    rotationDelaySeconds: 0n,
  },
];

export const MAINNET_EXECUTION: Readonly<Record<MainnetNetwork, boolean>> = Object.freeze({
  "base-mainnet": true,
  ethereum: false,
  "robinhood-mainnet": true,
  "solana-mainnet": true,
});
