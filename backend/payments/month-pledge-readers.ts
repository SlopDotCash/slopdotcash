/**
 * The chain readers of month pledges (operator decision, 15 November 2026).
 * Only the payments Worker reads the chain; pages read the stored rows.
 */

import * as evmAdapter from "../../contracts/evm/adapter";
import * as solanaAdapter from "../../contracts/solana/adapter";

import type { ChainMonthPledges } from "./month-pledges";

type EvmPledgeReader = (input: {
  rpcUrl: string;
  vault: string;
  periods: number[];
  blockTag?: string;
}) => Promise<ChainMonthPledges | null>;
type SolanaPledgeReader = (input: {
  rpcUrl: string;
  network: string;
  programId: string;
  projectPda: string;
  periods: number[];
}) => Promise<ChainMonthPledges | null>;

/**
 * The readers come from the contract adapters. Until the EVM contract change
 * that adds its reader is merged, it is absent and every EVM vault reads as
 * one without pledge support, which is today's behaviour. The Solana reader
 * returns null for a Project not yet migrated.
 */
export const chainPledgeReaders: {
  evm: EvmPledgeReader | undefined;
  solana: SolanaPledgeReader | undefined;
} = {
  evm: (evmAdapter as unknown as { readEvmMonthPledges?: EvmPledgeReader })
    .readEvmMonthPledges,
  solana: solanaAdapter.readSolanaMonthPledges,
};
