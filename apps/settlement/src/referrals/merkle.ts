// spec/settlement/referralPublication.md, "The next immutable filed tree supplies every root entry"; spec/settlement/referralAccrual.md, "Filed records, first-use wallet pins and exact roots commit atomically"
import { type Hex, encodeAbiParameters, keccak256 } from "viem";

export interface Leaf {
  readonly address: string;
  readonly cumulativeBase: bigint;
}

export interface ProvedLeaf extends Leaf {
  readonly hash: Hex;
  readonly proof: Hex[];
}

export interface MerkleTree {
  readonly root: Hex;
  readonly leaves: ProvedLeaf[];
}

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const UINT256_LIMIT = 1n << 256n;

/** @throws {TypeError | RangeError} */
export function leafHash(leaf: Leaf): Hex {
  if (!ADDRESS.test(leaf.address)) throw new TypeError("Leaf address is not a lowercase EVM address");
  if (leaf.cumulativeBase < 0n || leaf.cumulativeBase >= UINT256_LIMIT) throw new RangeError("Leaf amount out of uint256 range");
  return keccak256(keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [leaf.address as Hex, leaf.cumulativeBase])));
}

/** @throws {never} */
function pair(a: Hex, b: Hex): Hex {
  const [low, high] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(`0x${low.slice(2)}${high.slice(2)}`);
}

/** @throws {TypeError | RangeError} */
export function buildTree(input: ReadonlyArray<Leaf>): MerkleTree | null {
  if (input.length === 0) return null;
  const sorted = [...input].sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  for (let index = 1; index < sorted.length; index += 1)
    if (sorted[index]?.address === sorted[index - 1]?.address) throw new TypeError(`Duplicate leaf address ${sorted[index]?.address}`);
  const hashes = sorted.map(leafHash);
  const levels: Hex[][] = [hashes];
  for (let current = hashes; current.length > 1; ) {
    const next: Hex[] = [];
    for (let index = 0; index < current.length; index += 2) {
      const left = current[index] as Hex;
      const right = current[index + 1];
      next.push(right === undefined ? left : pair(left, right));
    }
    levels.push(next);
    current = next;
  }
  const leaves = sorted.map((leaf, index) => {
    const proof: Hex[] = [];
    let position = index;
    for (const nodes of levels.slice(0, -1)) {
      const sibling = nodes[position % 2 === 0 ? position + 1 : position - 1];
      if (sibling !== undefined) proof.push(sibling);
      position = Math.floor(position / 2);
    }
    return { ...leaf, hash: hashes[index] as Hex, proof };
  });
  return { root: levels[levels.length - 1]?.[0] as Hex, leaves };
}

/** @throws {TypeError | RangeError} */
export function verifyProof(root: Hex, leaf: Leaf, proof: ReadonlyArray<Hex>): boolean {
  return proof.reduce((node, sibling) => pair(node, sibling), leafHash(leaf)) === root;
}
