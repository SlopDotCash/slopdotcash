/**
 * Cumulative-claim Merkle tree over (address, cumulativeAmount) leaves, in the
 * shape ReferralDistributor.sol verifies: a leaf is
 * keccak256(bytes.concat(keccak256(abi.encode(address, uint256)))) and each
 * parent hashes its two children in sorted order. Double hashing keeps a leaf
 * from ever colliding with an internal node. Leaves are sorted by address so
 * the same totals always give the same root, which lets anyone rebuild the
 * tree from the public accrual file.
 */

import { encodeAbiParameters, keccak256 } from "viem";

export interface Leaf {
  /** Lowercase 0x address. */
  address: string;
  /** Token base units, cumulative over every filed epoch. */
  cumulativeBase: bigint;
}

export interface MerkleTree {
  root: `0x${string}`;
  leaves: (Leaf & { hash: `0x${string}`; proof: `0x${string}`[] })[];
}

const ADDRESS = /^0x[0-9a-f]{40}$/u;

export function leafHash(leaf: Leaf): `0x${string}` {
  if (!ADDRESS.test(leaf.address))
    throw new TypeError(`Leaf address is not a lowercase EVM address`);
  if (leaf.cumulativeBase < 0n || leaf.cumulativeBase >= 1n << 256n)
    throw new RangeError("Leaf amount out of uint256 range");
  return keccak256(
    keccak256(
      encodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        [leaf.address as `0x${string}`, leaf.cumulativeBase],
      ),
    ),
  );
}

function pair(a: `0x${string}`, b: `0x${string}`): `0x${string}` {
  const [low, high] = a.toLowerCase() <= b.toLowerCase() ? [a, b] : [b, a];
  return keccak256(`0x${low.slice(2)}${high.slice(2)}` as `0x${string}`);
}

/**
 * Builds the tree. An odd node at any level is promoted unchanged, so the
 * root of one leaf is that leaf's hash. Duplicate addresses are refused: one
 * cumulative total per claimant is the whole point of the design.
 */
export function buildTree(input: Leaf[]): MerkleTree | null {
  if (input.length === 0) return null;
  const sorted = [...input].sort((a, b) =>
    a.address < b.address ? -1 : a.address > b.address ? 1 : 0,
  );
  for (let i = 1; i < sorted.length; i += 1)
    if (sorted[i].address === sorted[i - 1].address)
      throw new TypeError(`Duplicate leaf address ${sorted[i].address}`);
  const hashes = sorted.map(leafHash);
  const levels: `0x${string}`[][] = [hashes];
  while (levels[levels.length - 1].length > 1) {
    const current = levels[levels.length - 1];
    const next: `0x${string}`[] = [];
    for (let i = 0; i < current.length; i += 2)
      next.push(
        i + 1 < current.length ? pair(current[i], current[i + 1]) : current[i],
      );
    levels.push(next);
  }
  const leaves = sorted.map((leaf, index) => {
    const proof: `0x${string}`[] = [];
    let position = index;
    for (let level = 0; level < levels.length - 1; level += 1) {
      const nodes = levels[level];
      const sibling = position % 2 === 0 ? position + 1 : position - 1;
      if (sibling < nodes.length) proof.push(nodes[sibling]);
      position = Math.floor(position / 2);
    }
    return { ...leaf, hash: hashes[index], proof };
  });
  return { root: levels[levels.length - 1][0], leaves };
}

/** Recomputes a root from one leaf and its proof, as the contract does. */
export function verifyProof(
  root: `0x${string}`,
  leaf: Leaf,
  proof: `0x${string}`[],
): boolean {
  let node = leafHash(leaf);
  for (const sibling of proof) node = pair(node, sibling);
  return node === root;
}
