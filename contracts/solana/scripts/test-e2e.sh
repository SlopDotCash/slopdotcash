#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .local
if [[ ! -f .local/payer.json ]]; then
  solana-keygen new --no-bip39-passphrase --silent --outfile .local/payer.json >/dev/null
fi
npm ci --ignore-scripts --legacy-peer-deps
bash scripts/build-local.sh
solana-test-validator --reset --quiet --ledger .local/ledger --rpc-port 18899 --faucet-port 18940 --dynamic-port-range 18901-18930 --bpf-program 4hXeYxsTKbwVKRRn8P1emGNDmVUSx13VMykfUAsbPnnj target/deploy/slop_escrow.so >.local/validator.log 2>&1 &
validator_pid=$!
trap 'kill "$validator_pid" 2>/dev/null || true' EXIT
export ANCHOR_PROVIDER_URL=http://127.0.0.1:18899
export ANCHOR_WALLET="$PWD/.local/payer.json"
for attempt in $(seq 1 40); do
  if solana --url "$ANCHOR_PROVIDER_URL" cluster-version >/dev/null 2>&1; then break; fi
  sleep 1
done
solana --url "$ANCHOR_PROVIDER_URL" airdrop 100 --keypair "$ANCHOR_WALLET" >/dev/null
bun build adapter.ts --target=node --outfile=.local/adapter.mjs
bun build ../../workers/payment-executor/solana.ts --target=node --outfile=.local/executor.mjs
bun build ../../workers/payments/scanner.ts ../../backend/payments/ledger.ts --target=node --outdir=.local --entry-naming='[name].mjs'
node --test --test-force-exit --test-isolation=none --test-concurrency=1 integration/escrow.e2e.mjs integration/executor.e2e.mjs integration/owner-plan.e2e.mjs
