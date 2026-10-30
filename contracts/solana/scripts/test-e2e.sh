#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .local
if [[ ! -f .local/payer.json ]]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile .local/payer.json >/dev/null
fi
npm ci --ignore-scripts --legacy-peer-deps
rpc_port=${SLOP_TEST_RPC_PORT:-18899}
faucet_port=$((rpc_port + 41))
dynamic_ports="$((rpc_port + 2))-$((rpc_port + 31))"
export ANCHOR_PROVIDER_URL="http://127.0.0.1:$rpc_port"
export ANCHOR_WALLET="$PWD/.local/payer.json"
validator_pid=""
trap 'if [[ -n "$validator_pid" ]]; then kill "$validator_pid" 2>/dev/null || true; fi' EXIT
# The program loads as upgradeable with the local payer as upgrade authority, so
# ProgramData exists and the payer can sign initialize_config, as on mainnet with the owner-controlled upgrade authority retained.
start_validator() {
  local program_arguments
  program_arguments=$(node integration/program-genesis.mjs)
  read -ra program_accounts <<<"$program_arguments"
  solana-test-validator --reset --quiet --ledger .local/ledger --rpc-port "$rpc_port" --faucet-port "$faucet_port" --dynamic-port-range "$dynamic_ports" "${program_accounts[@]}" "$@" >.local/validator.log 2>&1 &
  validator_pid=$!
  for attempt in $(seq 1 40); do
    if ! kill -0 "$validator_pid" 2>/dev/null; then
      cat .local/validator.log >&2
      exit 1
    fi
    if solana --url "$ANCHOR_PROVIDER_URL" cluster-version >/dev/null 2>&1; then break; fi
    sleep 1
  done
  solana --url "$ANCHOR_PROVIDER_URL" airdrop 100 --keypair "$ANCHOR_WALLET" >/dev/null
}
stop_validator() {
  kill "$validator_pid"
  wait "$validator_pid" 2>/dev/null || true
  validator_pid=""
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
# Reuse the same production build for the funded lifecycle suite. The validator also
# preloads a Project of the earlier 316-byte layout for the migrate_project check, and
# states no live validator reaches: a funded month past its admission window, an earlier month
# that already committed sources, and a vault holding less than its counters owe.
read -ra legacy_accounts <<<"$(node integration/legacy-project.mjs)"
read -ra monthly_accounts <<<"$(node integration/monthly-preload.mjs)"
read -ra token_accounts <<<"$(node integration/token-2022-preload.mjs)"
start_validator "${legacy_accounts[@]}" "${monthly_accounts[@]}" "${token_accounts[@]}"
bun build adapter.ts --target=node --outfile=.local/adapter.mjs
bun build monthly-reserve.ts --target=node --outfile=.local/monthly-reserve.mjs
bun build ../../workers/payment-executor/monthly-release.ts --target=node --outfile=.local/monthly-release-service.mjs
bun build funding.ts --target=node --outfile=.local/funding.mjs
bun build commitment.ts --target=node --outfile=.local/commitment.mjs
bun build owner-instructions.ts transactions.ts --target=node --outdir=.local --entry-naming='[name].mjs'
bun build owner-creation.ts --target=node --outfile=.local/owner-creation.mjs
bun build ../../workers/payment-executor/solana.ts --target=node --outfile=.local/executor.mjs
bun build ../../workers/payment-executor/solana-monthly.ts --target=node --outfile=.local/monthly-executor.mjs
bun build ../../workers/payments/scanner.ts ../../backend/payments/ledger.ts ../../backend/payments/handler.ts ../../backend/payments/vault-snapshots.ts --target=node --outdir=.local --entry-naming='[name].mjs'
bun build ../../workers/payment-executor/core.ts --target=node --outfile=.local/executor-core.mjs
bun build ../../workers/payments/index.ts --target=node --outfile=.local/payments-worker.mjs
bun build ../../backend/payments/dispatch.ts --target=node --outfile=.local/dispatch.mjs
# TAP emits failures immediately; spec retains custom error fields for receipt collection.
bash scripts/run-test-stage.sh lifecycle node --test --test-force-exit \
  --test-reporter=tap --test-reporter=spec \
  --test-reporter-destination=stdout --test-reporter-destination=stderr \
  --test-isolation=none --test-concurrency=1 integration/escrow.e2e.mjs integration/executor.e2e.mjs integration/owner-plan.e2e.mjs integration/owner-instructions.e2e.mjs integration/token-2022.e2e.mjs integration/native.e2e.mjs
