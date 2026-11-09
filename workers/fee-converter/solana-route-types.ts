/** Route expectation and account observation records shared by the Solana route checks. */

export interface JupiterRouteExpectation {
  program: string;
  wallet: string;
  inputMint: string;
  inputProgram: string;
  outputMint: string;
  outputProgram: string;
  amountIn: bigint;
  quotedOut: bigint;
  minimumOut: bigint;
  slippageBps: number;
  /** The exact fee SOL is wrapped and spent atomically; existing WSOL stays untouched. */
  nativeInput?: true;
}

export interface RouteAccountObservation {
  address: string;
  owner: string | null;
  executable: boolean | null;
  lamports: string | null;
  dataSha256: string | null;
  dataLength: number;
  slot: number;
}
