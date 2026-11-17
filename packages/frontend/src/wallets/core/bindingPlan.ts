// spec/frontend/walletConsent.md, "The prepared and signed bytes must equal the server's message before posting"; spec/backend/bindingConsent.md, "EVM consent names one registered deployment, the authorized claim and an expected version"; spec/backend/bindingConsent.md, "A Solana binding is one half-signed transaction per generation that only the wallet slot completes"
import { type TypedDataDefinition, canonicalSignature, recoverTypedData } from "@repo/platform/chain/evm";
import { type Address, type Blockhash, base58Encode, isAddress, isBlockhash } from "@repo/platform/chain/solana";
import { bytes32, evmAddress } from "@repo/settlement/chain/evm/abi";
import { NETWORKS, isNetworkKey } from "@repo/settlement/kernels/networks";
import { bindingTypedData } from "@repo/settlement/chain/evm/typedData";
import { digest, i64, u64 } from "@repo/settlement/chain/solana/bytes";
import { bindWallet } from "@repo/settlement/chain/solana/instructions";
import { compileLegacy } from "@repo/settlement/chain/solana/transactions";
import { destinationAt, payloadLength, preparedBindingShape, signaturesEnd } from "./payoutConsent.ts";

export interface EvmBindingTerms {
  readonly chainId: bigint;
  readonly vault: string;
  readonly actorId: string;
  readonly destination: string;
  readonly expectedVersion: string;
  readonly claimDigest: string;
  readonly expiresAt: string;
}

export interface SolanaBindingContext {
  readonly vault: string;
  readonly programId: string;
  readonly projectPda: string;
  readonly networkDomain: string;
  readonly githubUserId: string;
  readonly destination: string;
  readonly claimDigest: string;
}

const decimal = /^(0|[1-9][0-9]{0,19})$/u;
const hexDigest = /^[a-f0-9]{64}$/u;

/** @throws {never} */
function whole(text: string): bigint | undefined {
  return decimal.test(text) ? BigInt(text) : undefined;
}

/** @throws {never} */
export function evmChainIdOf(network: string): bigint | undefined {
  if (!isNetworkKey(network)) return undefined;
  const found = NETWORKS[network];
  return found.family === "evm" ? BigInt(found.chainId) : undefined;
}

/** @throws {never} */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value) ?? "";
}

/** @throws {never} */
function parsedEvmTerms(terms: EvmBindingTerms) {
  const vault = evmAddress(terms.vault);
  const destination = evmAddress(terms.destination);
  const claimDigest = bytes32(terms.claimDigest);
  const actor = whole(terms.actorId);
  const expectedVersion = whole(terms.expectedVersion);
  const expiresAt = whole(terms.expiresAt);
  if (vault === undefined || destination === undefined || claimDigest === undefined || actor === undefined || expectedVersion === undefined || expiresAt === undefined) return undefined;
  return { domain: { chainId: terms.chainId, vault }, input: { actor, destination, expectedVersion, claimDigest, expiresAt } };
}

/** @throws {never} */
export function expectedEvmBinding(terms: EvmBindingTerms): unknown {
  const parsed = parsedEvmTerms(terms);
  if (parsed === undefined) return undefined;
  try {
    return bindingTypedData(parsed.domain, parsed.input);
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function evmBindingSigner(terms: EvmBindingTerms, signature: string): string {
  const parsed = parsedEvmTerms(terms);
  const stored = canonicalSignature(signature);
  if (parsed === undefined || stored === undefined) return "";
  let typed;
  try {
    typed = bindingTypedData(parsed.domain, parsed.input);
  } catch {
    return "";
  }
  const definition: TypedDataDefinition = {
    types: { EIP712Domain: typed.types.EIP712Domain, DestinationBinding: typed.types.DestinationBinding },
    primaryType: "DestinationBinding",
    domain: { name: typed.domain.name, version: typed.domain.version, chainId: parsed.domain.chainId, verifyingContract: parsed.domain.vault },
    message: { ...parsed.input, actorId: parsed.input.actor },
  };
  return recoverTypedData(definition, stored)?.toLowerCase() ?? "";
}

/** @throws {never} */
export function preparedMessage(prepared: Uint8Array): Uint8Array {
  return prepared.slice(signaturesEnd);
}

/** @throws {never} */
export function attesterKey(prepared: Uint8Array): Uint8Array {
  return prepared.slice(signaturesEnd + 4, signaturesEnd + 36);
}

/** @throws {never} */
export function attesterSignature(prepared: Uint8Array): Uint8Array {
  return prepared.slice(1, 65);
}

/** @throws {never} */
export function destinationSignature(signed: Uint8Array): Uint8Array {
  return signed.slice(65, signaturesEnd);
}

/** @throws {never} */
export function withoutDestinationSignature(signed: Uint8Array): Uint8Array {
  const copy = Uint8Array.from(signed);
  copy.fill(0, 65, signaturesEnd);
  return copy;
}

/** @throws {never} */
export function destinationKeyMatches(prepared: Uint8Array, destination: Uint8Array): boolean {
  return destination.length === 32 && prepared.length >= destinationAt + 32 && destination.every((byte, index) => prepared[destinationAt + index] === byte);
}

/** @throws {never} */
export function expectedSolanaMessage(prepared: Uint8Array, context: SolanaBindingContext): Uint8Array | undefined {
  if (!preparedBindingShape(prepared) || !hexDigest.test(context.networkDomain) || !hexDigest.test(context.claimDigest)) return undefined;
  const message = preparedMessage(prepared);
  const count = message[3] ?? 0;
  const attester = base58Encode(message.slice(4, 36));
  const blockhash = base58Encode(message.slice(4 + count * 32, 36 + count * 32));
  const payload = message.slice(message.length - payloadLength);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const actor = whole(context.githubUserId);
  const network = digest(context.networkDomain);
  const claimDigest = digest(context.claimDigest);
  const version = u64(view.getBigUint64(48, true));
  const expiresAt = i64(view.getBigInt64(88, true));
  const actorId = actor === undefined ? undefined : u64(actor);
  if (!isAddress(attester) || !isBlockhash(blockhash) || !isAddress(context.programId) || !isAddress(context.projectPda) || !isAddress(context.destination)) return undefined;
  if (actorId === undefined || network === undefined || claimDigest === undefined || version === undefined || expiresAt === undefined) return undefined;
  const payer: Address = attester;
  const built = bindWallet({
    program: context.programId,
    project: context.projectPda,
    payer,
    identityAuthority: payer,
    destination: context.destination,
    actor: actorId,
    network,
    expectedVersion: version,
    claimDigest,
    expiresAt,
  });
  if (built.kind !== "built") return undefined;
  const compiled = compileLegacy({ payer, blockhash: blockhash as Blockhash, instructions: [built.value] });
  return compiled.kind === "compiled" ? compiled.bytes : undefined;
}
