/// <reference types="bun-types" />
/**
 * Regression guard for the Squads v4 member-vector layout.
 *
 * The rent collector is an `Option<Pubkey>`. Borsh writes a key only when the
 * option is set, so the member vector begins 32 bytes earlier when the
 * collector is unset. The account allocation always reserves those 32 bytes,
 * which is why an unset collector leaves zero padding after the last member.
 * Reading the member count at one fixed offset rejected every such vault.
 *
 * The first case is a finalized mainnet account, so the expected layout comes
 * from chain state and not from this test.
 */

import { describe, expect, test } from "bun:test";
import {
  assertSquadsVaultIdentity,
  decodeBase58Bytes,
  deriveSquadsVaultAddress,
  SQUADS_V4_PROGRAM_ID,
  squadsMemberCountOffset,
} from "../../src/lib/squads-funding";

const MULTISIG_DISCRIMINATOR = [224, 116, 121, 186, 68, 161, 79, 236];

const MULTISIG = "1NDS49JiZgQYm8oAcE2wc3KZWDFZimMHgL2XXdjpr2o";
const FUNDER = "BfafLsFDSp5BFCVo47amqjU6FpBsXEKCk8hkFkG5eg5Z";
const STEWARD = "Du3Nsn2ZPumMddfgiZ4TZbaGjFbsj7yJhiNf2vH8xKJz";
const VOTE_AND_EXECUTE = 6;
const ALL_PERMISSIONS = 7;
const EXECUTE_ONLY = 4;

/** Finalized mainnet multisig with an unset rent collector. Read from Solana RPC. */
const MAINNET_UNSET_COLLECTOR =
  "4HR5ukShT+zCOTolVJgy2ZDC7/w6yx2N+sjZ58Ej9mlDdliYlRYv7gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAAAAQAAAAAAAAAAAAAAAAAAAAD/AgAAAJ53AC6Rf2nQcqTsRWzJNiW+Gi4/zfu3fXJkg04fx0CsB7+hIg/i0tJY7SdQNB/pS00A5Bo5Yd6b2+pIJaic8FZjBwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

interface BuildOptions {
  threshold?: number;
  members: { key: string; permissions: number }[];
  rentCollector?: string | null;
  configAuthority?: string | null;
}

/** Builds a canonical Squads v4 multisig account in the 2-of-2 shape. */
function buildMultisig(options: BuildOptions): string {
  const { threshold = 2, members, rentCollector = null } = options;
  const bytes = new Uint8Array(132 + 33 * members.length);
  bytes.set(MULTISIG_DISCRIMINATOR, 0);
  if (options.configAuthority)
    bytes.set(decodeBase58Bytes(options.configAuthority), 40);
  const view = new DataView(bytes.buffer);
  view.setUint16(72, threshold, true);
  bytes[94] = rentCollector ? 1 : 0;
  if (rentCollector) bytes.set(decodeBase58Bytes(rentCollector), 95);
  const memberCountOffset = squadsMemberCountOffset(bytes);
  bytes[memberCountOffset - 1] = 1;
  view.setUint32(memberCountOffset, members.length, true);
  members.forEach((member, index) => {
    const offset = memberCountOffset + 4 + 33 * index;
    bytes.set(decodeBase58Bytes(member.key), offset);
    bytes[offset + 32] = member.permissions;
  });
  return Buffer.from(bytes).toString("base64");
}

function accountOf(data: string) {
  return {
    owner: SQUADS_V4_PROGRAM_ID,
    executable: false,
    data: [data, "base64"],
  };
}

/** Rewrites one byte of a real fixture without rebuilding the account. */
function withByte(data: string, index: number, value: number): string {
  const bytes = Uint8Array.from(Buffer.from(data, "base64"));
  bytes[index] = value;
  return Buffer.from(bytes).toString("base64");
}

const vault = await deriveSquadsVaultAddress(MULTISIG, 0);

describe("Squads v4 2-of-2 vault identity", () => {
  test("accepts a finalized mainnet vault whose rent collector is unset", async () => {
    const identity = await assertSquadsVaultIdentity(
      accountOf(MAINNET_UNSET_COLLECTOR),
      MULTISIG,
      vault,
      0,
      FUNDER,
      STEWARD,
    );
    expect(identity.threshold).toBe(2);
    expect(identity.memberCount).toBe(2);
    expect(identity.funderMember).toBe(FUNDER);
    expect(identity.stewardMember).toBe(STEWARD);
    expect(identity.vault).toBe(vault);
  });

  test("accepts the same members when the rent collector is set", async () => {
    const identity = await assertSquadsVaultIdentity(
      accountOf(
        buildMultisig({
          members: [
            { key: FUNDER, permissions: ALL_PERMISSIONS },
            { key: STEWARD, permissions: ALL_PERMISSIONS },
          ],
          rentCollector: FUNDER,
        }),
      ),
      MULTISIG,
      vault,
      0,
      FUNDER,
      STEWARD,
    );
    expect(identity.memberCount).toBe(2);
  });

  test("accepts members declared in the other order", async () => {
    const identity = await assertSquadsVaultIdentity(
      accountOf(
        buildMultisig({
          members: [
            { key: FUNDER, permissions: ALL_PERMISSIONS },
            { key: STEWARD, permissions: ALL_PERMISSIONS },
          ],
        }),
      ),
      MULTISIG,
      vault,
      0,
      STEWARD,
      FUNDER,
    );
    expect(identity.funderMember).toBe(STEWARD);
    expect(identity.stewardMember).toBe(FUNDER);
  });

  test("rejects a member that cannot vote", async () => {
    await expect(
      assertSquadsVaultIdentity(
        accountOf(
          buildMultisig({
            members: [
              { key: FUNDER, permissions: ALL_PERMISSIONS },
              { key: STEWARD, permissions: EXECUTE_ONLY },
            ],
          }),
        ),
        MULTISIG,
        vault,
        0,
        FUNDER,
        STEWARD,
      ),
    ).rejects.toThrow(/exact two reviewed voting members/u);
  });

  test("rejects a third member", async () => {
    const third = await deriveSquadsVaultAddress(MULTISIG, 7);
    await expect(
      assertSquadsVaultIdentity(
        accountOf(
          buildMultisig({
            members: [
              { key: FUNDER, permissions: ALL_PERMISSIONS },
              { key: STEWARD, permissions: VOTE_AND_EXECUTE },
              { key: third, permissions: VOTE_AND_EXECUTE },
            ],
          }),
        ),
        MULTISIG,
        vault,
        0,
        FUNDER,
        STEWARD,
      ),
    ).rejects.toThrow(/exact 2-of-2 multisig/u);
  });

  test("rejects a threshold that is not two", async () => {
    await expect(
      assertSquadsVaultIdentity(
        accountOf(
          buildMultisig({
            threshold: 3,
            members: [
              { key: FUNDER, permissions: ALL_PERMISSIONS },
              { key: STEWARD, permissions: ALL_PERMISSIONS },
            ],
          }),
        ),
        MULTISIG,
        vault,
        0,
        FUNDER,
        STEWARD,
      ),
    ).rejects.toThrow(/exact 2-of-2 multisig/u);
  });

  test("rejects an unreviewed member", async () => {
    const other = await deriveSquadsVaultAddress(MULTISIG, 7);
    await expect(
      assertSquadsVaultIdentity(
        accountOf(
          buildMultisig({
            members: [
              { key: FUNDER, permissions: ALL_PERMISSIONS },
              { key: other, permissions: ALL_PERMISSIONS },
            ],
          }),
        ),
        MULTISIG,
        vault,
        0,
        FUNDER,
        STEWARD,
      ),
    ).rejects.toThrow(/exact two reviewed voting members/u);
  });

  test("rejects a rent collector tag that is not a Borsh option", async () => {
    await expect(
      assertSquadsVaultIdentity(
        accountOf(withByte(MAINNET_UNSET_COLLECTOR, 94, 2)),
        MULTISIG,
        vault,
        0,
        FUNDER,
        STEWARD,
      ),
    ).rejects.toThrow(/rent collector is not canonical/u);
  });

  test("rejects a configuration authority", async () => {
    await expect(
      assertSquadsVaultIdentity(
        accountOf(
          buildMultisig({
            members: [
              { key: FUNDER, permissions: ALL_PERMISSIONS },
              { key: STEWARD, permissions: ALL_PERMISSIONS },
            ],
            configAuthority: FUNDER,
          }),
        ),
        MULTISIG,
        vault,
        0,
        FUNDER,
        STEWARD,
      ),
    ).rejects.toThrow(/no config authority/u);
  });

  test("rejects a vault that is not the canonical PDA", async () => {
    const other = await deriveSquadsVaultAddress(MULTISIG, 7);
    await expect(
      assertSquadsVaultIdentity(
        accountOf(MAINNET_UNSET_COLLECTOR),
        MULTISIG,
        other,
        0,
        FUNDER,
        STEWARD,
      ),
    ).rejects.toThrow(/not the canonical Squads PDA/u);
  });
});
