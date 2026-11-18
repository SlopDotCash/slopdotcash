#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .local
if [[ ! -f .local/payer.json ]]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile .local/payer.json >/dev/null
fi
rpc_port=${SLOP_TEST_RPC_PORT:-18899}
faucet_port=$((rpc_port + 41))
dynamic_ports="$((rpc_port + 2))-$((rpc_port + 31))"
export ANCHOR_PROVIDER_URL="http://127.0.0.1:$rpc_port"
# Any answer on the RPC port means another process owns it; the tests would run against it.
rpc_answers() {
  node -e 'fetch(process.argv[1], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }), signal: AbortSignal.timeout(2000) }).then(() => process.exit(0), () => process.exit(1))' "$ANCHOR_PROVIDER_URL"
}
refuse_occupied_port() {
  if rpc_answers; then
    printf '%s\n' "Refusing to start: $ANCHOR_PROVIDER_URL already answers. Stop that process or set SLOP_TEST_RPC_PORT." >&2
    return 1
  fi
}
refuse_occupied_port
npm ci --ignore-scripts --legacy-peer-deps
export ANCHOR_WALLET="$PWD/.local/payer.json"
validator_pid=""
validator_receipt=""
# A native solana-test-validator 2.1.21 on PATH runs directly; otherwise the
# pinned container image of ../../../scripts/local-solana-validator.mjs runs.
validator=container
if [[ "$(solana-test-validator --version 2>/dev/null)" == "solana-test-validator 2.1.21 "* ]]; then
  validator=native
fi
printf 'Local validator: %s\n' "$validator"
receipt_state() {
  node -e 'try { process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).state ?? ""); } catch {}' "$validator_receipt"
}
rpc_healthy() {
  node -e 'fetch(process.argv[1], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }), signal: AbortSignal.timeout(2000) }).then((r) => r.json()).then((b) => process.exit(b.result === "ok" ? 0 : 1), () => process.exit(1))' "$ANCHOR_PROVIDER_URL"
}
stop_validator() {
  if [[ -z "$validator_pid" ]]; then return 0; fi
  local status=0
  kill -TERM "$validator_pid" 2>/dev/null || true
  wait "$validator_pid" 2>/dev/null || status=$?
  validator_pid=""
  if [[ "$validator" == native ]]; then printf '{"state":"stopped"}\n' >"$validator_receipt"; fi
  if [[ "$(receipt_state)" != "stopped" ]]; then
    printf '%s\n' "The owned validator did not confirm cleanup: $validator_receipt" >&2
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
# The program loads as upgradeable with the local payer as upgrade authority, so
# ProgramData exists and the payer can sign initialize_config, as on mainnet with the owner-controlled upgrade authority retained.
start_validator() {
  refuse_occupied_port
  local program_arguments
  program_arguments=$(node integration/program-genesis.mjs)
  read -ra program_accounts <<<"$program_arguments"
  local arguments=("${program_accounts[@]}" "$@")
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
  # A new receipt per stage cannot reuse the first validator's stopped state.
  validator_receipt=$(mktemp "$PWD/.local/validator-receipt.XXXXXX")
  local validator_arguments=(--reset --quiet --ledger "$PWD/.local/ledger" --rpc-port "$rpc_port" --faucet-port "$faucet_port" --dynamic-port-range "$dynamic_ports" "${arguments[@]}")
  if [[ "$validator" == native ]]; then
    solana-test-validator "${validator_arguments[@]}" >.local/validator.log 2>&1 &
  else
    SLOP_SOLANA_CONTAINER_RECEIPT="$validator_receipt" node ../../../scripts/local-solana-validator.mjs "${mounts[@]}" -- "${validator_arguments[@]}" >.local/validator.log 2>&1 &
  fi
  validator_pid=$!
  for attempt in $(seq 1 120); do
    if ! kill -0 "$validator_pid" 2>/dev/null; then
      cat .local/validator.log >&2
      return 1
    fi
    if [[ "$validator" == native ]] && rpc_healthy; then printf '{"state":"ready"}\n' >"$validator_receipt"; fi
    if [[ "$(receipt_state)" == "ready" ]]; then break; fi
    sleep 1
  done
  if [[ "$(receipt_state)" != "ready" ]]; then
    cat .local/validator.log >&2
    return 1
  fi
  if [[ "$validator" == native ]]; then
    local expected actual
    expected=$(solana-keygen pubkey "$PWD/.local/ledger/validator-keypair.json")
    actual=$(node -e 'fetch(process.argv[1], { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getIdentity" }), signal: AbortSignal.timeout(2000) }).then((r) => r.json()).then((b) => process.stdout.write(b.result?.identity ?? ""), () => process.exit(1))' "$ANCHOR_PROVIDER_URL")
    if [[ -z "$expected" || "$actual" != "$expected" ]]; then
      printf '%s\n' "The validator at $ANCHOR_PROVIDER_URL is not the one this run started." >&2
      return 1
    fi
  fi
  node scripts/airdrop-local.mjs
}
# CI qualifies the exact retained production artifact. Local runs without one
# keep building their program as before. IDL extraction does not replace it.
if [[ -n "${SLOP_SOLANA_TEST_ARTIFACT:-}" ]]; then
  mkdir -p target/idl
  anchor idl build --out target/idl/slop_escrow.json
  node scripts/prepare-test-program.mjs "$SLOP_SOLANA_TEST_ARTIFACT"
else
  bash scripts/build-local.sh
fi
# Prove the production build accepts zero delay and rejects invalid bounds.
start_validator
bash scripts/run-test-stage.sh production-delay node --test --test-force-exit --test-isolation=none integration/production-delay.e2e.mjs
stop_validator
# The lifecycle suites drive the program through the off-chain TypeScript client
# (adapter.ts, funding.ts, owner-creation.ts, commitment.ts, owner-instructions.ts,
# monthly-reserve.ts) and the payment services. Neither is on this branch: they
# return with the business logic, together with the validator stage that preloads
# integration/legacy-project.mjs, monthly-preload.mjs, token-2022-preload.mjs and
# pledge-preload.mjs for them.
skip_suite() {
  printf 'SKIP integration/%s: needs %s, not on this branch\n' "$1" "$2"
}
printf '%s\n' 'SKIP reason shared by every suite below: adapter.ts imports acceptsPayoutFee from src/lib/payments/contracts.ts and, through native.ts, normalizedNativeDelta from src/lib/verified-money.ts; funding.ts and commitment.ts call ordinaryFee and acceptsPayoutFee. That payment fee policy is business logic.'
skip_suite escrow.e2e.mjs 'adapter.ts, monthly-reserve.ts and workers/payment-executor (monthly-release.ts, solana-monthly.ts)'
skip_suite executor.e2e.mjs 'adapter.ts, workers/payment-executor, workers/payments and backend/payments'
skip_suite keeper.e2e.mjs 'adapter.ts, transactions.ts, scripts/payment-keeper (budget.ts, keeper.ts, store.ts), functions/api/v1/[[path]].ts, src/lib (escrow-policy.mjs, payments/monthly-allocation.ts, project-schema.mjs), tests/project-application-manifest.ts, tests/sqlite-d1.ts and workers/payment-executor/solana-monthly.ts'
skip_suite native.e2e.mjs 'adapter.ts, funding.ts, owner-creation.ts and workers/payment-executor/solana.ts'
skip_suite owner-instructions.e2e.mjs 'funding.ts, owner-creation.ts and owner-instructions.ts'
skip_suite owner-plan.e2e.mjs 'commitment.ts, funding.ts and backend/payments/handler.ts'
skip_suite pledge.e2e.mjs 'adapter.ts'
skip_suite token-2022.e2e.mjs 'adapter.ts and funding.ts'
