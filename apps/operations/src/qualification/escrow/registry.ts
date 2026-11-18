// spec/operations/escrowQualification.md, "Qualification requires launch, exact network and vault evidence, a reviewed plan, and current owner authorization"
import { REVIEWED_FACTORIES, REVIEWED_SOLANA_PROGRAMS, type ReviewedFactory, type ReviewedSolanaProgram } from "@repo/platform/chain/reviewed";

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

const evmNetworks: Readonly<Record<string, ReviewedEvm["network"]>> = { "base-mainnet": "Base", "robinhood-mainnet": "Robinhood", ethereum: "Ethereum" };

const reviewedCodeRegionLength: Readonly<Record<string, number>> = { f250228d87493c024737de9dea4290ed0d28ed777eaddf17b874d493b77274a6: 731_040 };

const evmOf = (entry: ReviewedFactory): ReadonlyArray<ReviewedEvm> => {
  const network = Object.hasOwn(evmNetworks, entry.network) ? evmNetworks[entry.network] : undefined;
  return network === undefined || entry.codeSha256 !== entry.factoryCodeSha256 ? [] : [{
    network,
    sourceCommit: entry.sourceCommit,
    factory: entry.factory,
    proxyCodeSha256: entry.factoryCodeSha256,
    vaultImplementation: entry.upgrade.vaultImplementation,
    vaultImplementationCodeSha256: entry.upgrade.vaultImplementationCodeSha256,
    factoryImplementation: entry.upgrade.factoryImplementation,
    factoryImplementationCodeSha256: entry.upgrade.factoryImplementationCodeSha256,
    authority: entry.upgrade.authority,
  }];
};

const solanaOf = (entry: ReviewedSolanaProgram): ReadonlyArray<ReviewedSolana> => {
  const programLength = Object.hasOwn(reviewedCodeRegionLength, entry.codeSha256) ? reviewedCodeRegionLength[entry.codeSha256] : undefined;
  return entry.network !== "solana-mainnet" || programLength === undefined ? [] : [{
    network: "Solana",
    program: entry.programId,
    programSha256: entry.codeSha256,
    programLength,
    authority: entry.upgradeAuthority,
  }];
};

export const reviewedRegistry: Registry = { evm: REVIEWED_FACTORIES.flatMap(evmOf), solana: REVIEWED_SOLANA_PROGRAMS.flatMap(solanaOf) };

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
  return { evm: registry.evm.map((entry) => entry.authority.toLowerCase()), solana: [] };
}
