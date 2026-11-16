#!/usr/bin/env bash
set -euo pipefail
stage=$1
shift
case "$stage" in production-delay|lifecycle) ;; *) exit 2 ;; esac
mkdir -p .local/failure-evidence
log=$(mktemp ".local/$stage.XXXXXX")
status=0
"$@" 2>&1 | tee "$log" || {
  statuses=("${PIPESTATUS[@]}")
  status=${statuses[0]}
  if [[ "$status" == 0 ]]; then status=${statuses[1]}; fi
}
if [[ "$status" != 0 ]]; then
  # The caller still owns a live validator here. Never replace the test failure
  # with the diagnostic result, and never upload raw logs or transaction bytes.
  node scripts/failure-evidence.mjs "$log" "$status" ||
    printf '%s\n' 'Safe validator failure evidence could not be collected.' >&2
fi
exit "$status"
