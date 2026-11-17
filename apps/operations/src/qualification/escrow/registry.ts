// spec/operations/escrowQualification.md, "Qualification requires launch, exact network and vault evidence, a reviewed plan, and current owner authorization"

export interface ReviewedEvm {
  readonly network: "Base" | "Robinhood" | "Ethereum";
  readonly sourceCommit: string;
  readonly factory: string;
  readonly proxyCodeSha256: string;
  readonly vaultImplementation: string;
  readonly vaultImplementationCodeSha256: string;
  readonly factoryImplementation: string;
  readonly factoryImplementationCodeSha256: string;
  readonly authority: string;
}

export interface ReviewedSolana {
  readonly network: "Solana";
  readonly program: string;
  readonly programSha256: string;
  readonly programLength: number;
  readonly authority: string;
}

export interface Registry {
  readonly evm: ReadonlyArray<ReviewedEvm>;
  readonly solana: ReadonlyArray<ReviewedSolana>;
}

const reviewedEvm = (network: ReviewedEvm["network"]): ReviewedEvm => ({
  network,
  sourceCommit: "7fdedd3507c3f79217ccc896ace0e0b7472ca092",
  factory: "0xe51abf8c6dbb3ca6e9ad09f2dc6ef141d7364aab",
  proxyCodeSha256: "afb62459ccdd87d344b8bfa367c8dc49586323316bb8a51f1dfbe753336c0509",
  vaultImplementation: "0x90c46e3e5be35b1048cd69403d1402feed1240d8",
  vaultImplementationCodeSha256: "155c7ea2fdeeaeccfd6daac64b6105e968c1927092f8761f34090a8b42e15bfc",
  factoryImplementation: "0x9f27aec70559d8f4ca1a62398e673a25b1ce3e2f",
  factoryImplementationCodeSha256: "976208154ce5e58f59d826e58273d917adc226109bf95ab4894b9cf144e4a1dd",
  authority: "0x2ad20afa352ec70e43a6d0e7794cf305c9cbe35d",
});

export const reviewedRegistry: Registry = { evm: [reviewedEvm("Base"), reviewedEvm("Robinhood"), reviewedEvm("Ethereum")], solana: [] };

/** @throws {never} */
export function reviewedEvmOf(registry: Registry, network: string): ReviewedEvm | undefined {
  return registry.evm.find((entry) => entry.network === network);
}

/** @throws {never} */
export function reviewedSolanaOf(registry: Registry, network: string): ReviewedSolana | undefined {
  return registry.solana.find((entry) => entry.network === network);
}

/** @throws {never} */
export function approvalKeys(registry: Registry): { readonly evm: ReadonlyArray<string>; readonly solana: ReadonlyArray<string> } {
  return { evm: registry.evm.map((entry) => entry.authority.toLowerCase()), solana: registry.solana.map((entry) => entry.authority) };
}
