#!/usr/bin/env bash
# Run after the normal complete suite, on its existing single-worker runner.
set -euo pipefail

evidence=.cache/browser-performance
selection='built solver (bdef|sdef|qdef)/|built (VMD|morph|group) conformance:'

test -f test-results/browser-summary.json
# Refuse to mix artifacts from different invocations.
test ! -e "$evidence"
mkdir -p "$evidence"
cp -R test-results "$evidence/default"
git rev-parse HEAD > "$evidence/commit.txt"

# Playwright clears test-results on each run. Preserve the full default suite
# for browser-evidence even if a measurement fails, and archive the failure too.
restore_default() {
  rm -rf test-results
  cp -R "$evidence/default" test-results
}
trap restore_default EXIT

# Reverse the order in the second pair to expose cache/order effects. These are
# the same 15 conformance cases, with identical source and browser provisioning.
for measurement in full-1 representative-1 representative-2 full-2; do
  matrix=${measurement%-*}
  echo "$measurement" >> "$evidence/order.txt"
  outcome=0
  BROWSER_CONFORMANCE_MATRIX="$matrix" npm run test:browser -- \
    tests/browser/solver.spec.ts tests/browser/vmd.spec.ts tests/browser/group.spec.ts \
    --grep "$selection" || outcome=$?
  cp -R test-results "$evidence/$measurement"
  printf '%s\n' "$outcome" > "$evidence/$measurement/exit-code.txt"
  if (( outcome != 0 )); then
    exit "$outcome"
  fi
done
