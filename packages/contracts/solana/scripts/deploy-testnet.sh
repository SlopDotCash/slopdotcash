#!/usr/bin/env bash
# Operator entry point. Never invoke with production signing material.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${SLOP_TEST_CLUSTER:?Set devnet or testnet}"
: "${SLOP_TEST_PAYER:?Set isolated test payer keypair file}"
: "${SLOP_TEST_PROGRAM_KEYPAIR:?Set program identity keypair file}"
: "${SLOP_TEST_UPGRADE_AUTHORITY:?Set isolated test upgrade authority keypair file}"
: "${SLOP_EXPECTED_GENESIS:?Set reviewed test cluster genesis hash}"
case "$SLOP_TEST_CLUSTER" in
  devnet) rpc=https://api.devnet.solana.com ;;
  testnet) rpc=https://api.testnet.solana.com ;;
  *) echo 'Only devnet and testnet are allowed.' >&2; exit 1 ;;
esac
actual_genesis=$(solana --url "$rpc" genesis-hash)
[[ "$actual_genesis" == "$SLOP_EXPECTED_GENESIS" ]] || { echo 'Genesis mismatch' >&2; exit 1; }
program_id=$(solana-keygen pubkey "$SLOP_TEST_PROGRAM_KEYPAIR")
# Program identity must be explicitly reviewed in source before building.
rg -F "declare_id!(\"$program_id\");" programs/slop-escrow/src/lib.rs >/dev/null
[[ -z "$(git status --porcelain -- .)" ]] || { echo 'Commit and review the exact deployment source first.' >&2; exit 1; }
anchor build --no-idl -- --tools-version v1.52 -- --locked
anchor idl build --out target/idl/slop_escrow.json
solana --url "$rpc" --keypair "$SLOP_TEST_PAYER" program deploy target/deploy/slop_escrow.so --program-id "$SLOP_TEST_PROGRAM_KEYPAIR" --upgrade-authority "$SLOP_TEST_UPGRADE_AUTHORITY"
solana --url "$rpc" program show "$program_id" --output json
mkdir -p .local
solana --url "$rpc" program dump "$program_id" .local/deployed.so
# ProgramData may include trailing allocation padding. Compare the actual ELF prefix.
python3 - <<'PY'
from pathlib import Path
import hashlib
local=Path('target/deploy/slop_escrow.so').read_bytes()
remote=Path('.local/deployed.so').read_bytes()
assert remote[:len(local)]==local, 'Deployed bytes differ'
assert not any(remote[len(local):]), 'Unexpected nonzero trailing program bytes'
print('compiled_program_sha256='+hashlib.sha256(local).hexdigest())
print('deployed_code_sha256='+hashlib.sha256(remote).hexdigest())
PY
