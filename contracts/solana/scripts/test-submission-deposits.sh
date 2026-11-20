#!/usr/bin/env bash
# Builds the submission deposit program and runs its suites against an isolated local
# validator, in two stages because the reclaim delay is fixed once per deployment:
#   rehearsal  the mainnet parameters (30 days, a mint at the USDC address, the fee wallet)
#   lifecycle  a six-second delay, every instruction and refusal, and the invariant campaign
# Local test funds and fixture keys only. Nothing here can reach a public cluster.
set -euo pipefail
cd "$(dirname "$0")/.."
program=slop_submission_deposits
mkdir -p .local
if [[ ! -f .local/payer.json ]]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile .local/payer.json >/dev/null
fi
npm ci --ignore-scripts --legacy-peer-deps
rpc_port=${SLOP_SUBMISSION_DEPOSITS_RPC_PORT:-18999}
faucet_port=$((rpc_port + 41))
dynamic_ports="$((rpc_port + 2))-$((rpc_port + 31))"
export ANCHOR_PROVIDER_URL="http://127.0.0.1:$rpc_port"
export ANCHOR_WALLET="$PWD/.local/payer.json"
# `container` is the reviewed pinned validator image that CI uses. `host` runs the
# solana-test-validator on PATH, for a machine without a container engine; it is an explicit
# choice, never a fallback, and its results are not evidence for the pinned version.
validator_mode=${SLOP_SOLANA_VALIDATOR:-container}
case "$validator_mode" in container|host) ;; *) echo 'SLOP_SOLANA_VALIDATOR must be container or host' >&2; exit 2 ;; esac
validator_pid=""
validator_receipt=""
receipt_state() {
  node -e 'try { process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).state ?? ""); } catch {}' "$validator_receipt"
}
healthy() {
  node -e 'fetch(process.argv[1], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }) }).then((r) => r.json()).then((b) => process.exit(b.result === "ok" ? 0 : 1)).catch(() => process.exit(1))' "$ANCHOR_PROVIDER_URL"
}
stop_validator() {
  if [[ -z "$validator_pid" ]]; then return 0; fi
  local status=0
  kill -TERM "$validator_pid" 2>/dev/null || true
  wait "$validator_pid" 2>/dev/null || status=$?
  validator_pid=""
  if [[ "$validator_mode" == container && "$(receipt_state)" != "stopped" ]]; then
    printf '%s\n' "The owned validator did not confirm cleanup: $validator_receipt" >&2
    return 1
  fi
  if [[ "$validator_mode" == host ]]; then
    for attempt in $(seq 1 40); do
      if ! healthy; then return 0; fi
      sleep 0.25
    done
    printf '%s\n' 'The host validator still answers after termination.' >&2
    return 1
  fi
  if [[ "$status" != 0 && "$status" != 143 ]]; then return "$status"; fi
}
cleanup() {
  local status=$?
  trap - EXIT
  if ! stop_validator; then
    printf '%s\n' 'Validator cleanup failed.' >&2
    if [[ "$status" == 0 ]]; then status=1; fi
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
# The program loads as upgradeable with the local payer as upgrade authority, so ProgramData
# exists and the payer can sign initialize, as the deployer does on mainnet.
start_validator() {
  local stage=$1
  local genesis
  genesis=$(node integration/submission-deposits-preload.mjs "$stage")
  read -ra arguments <<<"$genesis"
  local mounts=()
  local index path
  for ((index=0; index<${#arguments[@]}; index++)); do
    if [[ "${arguments[index]}" == "--account" ]]; then
      path="${arguments[index+2]}"
      if [[ "$path" != /* ]]; then path="$PWD/$path"; fi
      arguments[index+2]="$path"
      mounts+=(--readonly-mount "$path")
      index=$((index + 2))
    fi
  done
  if [[ "$validator_mode" == host ]]; then
    if healthy; then
      printf '%s\n' "Another validator already answers on $ANCHOR_PROVIDER_URL." >&2
      return 1
    fi
    # --mint names the local payer, so the host validator never reads a default keypair.
    solana-test-validator --reset --quiet --ledger "$PWD/.local/submission-deposits-ledger" \
      --bind-address 127.0.0.1 --rpc-port "$rpc_port" --faucet-port "$faucet_port" \
      --gossip-port "$((rpc_port + 32))" \
      --dynamic-port-range "$dynamic_ports" --mint "$(solana-keygen pubkey .local/payer.json)" \
      "${arguments[@]}" >.local/submission-deposits-validator.log 2>&1 &
    validator_pid=$!
    for attempt in $(seq 1 120); do
      if ! kill -0 "$validator_pid" 2>/dev/null; then
        cat .local/submission-deposits-validator.log >&2
        return 1
      fi
      if healthy; then return 0; fi
      sleep 1
    done
    cat .local/submission-deposits-validator.log >&2
    return 1
  fi
  # A new receipt per stage cannot reuse the first validator's stopped state.
  validator_receipt=$(mktemp "$PWD/.local/submission-deposits-receipt.XXXXXX")
  SLOP_SOLANA_CONTAINER_RECEIPT="$validator_receipt" node ../../scripts/local-solana-validator.mjs "${mounts[@]}" -- --reset --quiet --ledger "$PWD/.local/submission-deposits-ledger" --rpc-port "$rpc_port" --faucet-port "$faucet_port" --dynamic-port-range "$dynamic_ports" "${arguments[@]}" >.local/submission-deposits-validator.log 2>&1 &
  validator_pid=$!
  for attempt in $(seq 1 120); do
    if ! kill -0 "$validator_pid" 2>/dev/null; then
      cat .local/submission-deposits-validator.log >&2
      return 1
    fi
    if [[ "$(receipt_state)" == "ready" ]]; then break; fi
    sleep 1
  done
  if [[ "$(receipt_state)" != "ready" ]]; then
    cat .local/submission-deposits-validator.log >&2
    return 1
  fi
  node scripts/airdrop-local.mjs
}
run_suite() {
  node --test --test-force-exit --test-reporter=spec --test-isolation=none --test-concurrency=1 "$@"
}
# CI qualifies the exact retained build of the pinned image. Local runs without one build
# the program here. IDL extraction never replaces the program under test.
mkdir -p target/idl
if [[ -n "${SLOP_SOLANA_TEST_ARTIFACT:-}" ]]; then
  anchor idl build -p "$program" --out "target/idl/$program.json"
  node scripts/prepare-test-program.mjs "$SLOP_SOLANA_TEST_ARTIFACT" slop-submission-deposits
else
  cargo build-sbf --manifest-path programs/slop-submission-deposits/Cargo.toml --tools-version v1.52 -- --locked
  anchor idl build -p "$program" --out "target/idl/$program.json"
fi
# The committed IDL is what the Worker and the pay page read. It must be this build's.
node -e 'const fs = require("node:fs"); const read = (path) => JSON.stringify(JSON.parse(fs.readFileSync(path, "utf8"))); if (read(process.argv[1]) !== read(process.argv[2])) { console.error("idl/" + process.argv[3] + ".json is stale: copy the built IDL over it."); process.exit(1); }' "target/idl/$program.json" "idl/$program.json" "$program"
cargo test --locked -p slop-submission-deposits

start_validator rehearsal
run_suite integration/submission-deposits-rehearsal.e2e.mjs
stop_validator

start_validator lifecycle
run_suite integration/submission-deposits.e2e.mjs
# A separate run: the campaign needs the roles the lifecycle suite leaves in place.
run_suite integration/submission-deposits-invariant.e2e.mjs
