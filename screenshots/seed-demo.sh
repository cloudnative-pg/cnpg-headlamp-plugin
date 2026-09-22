#!/usr/bin/env bash
# Seeds the demo namespace used for README screenshots.
#
# Usage:
#   ./screenshots/seed-demo.sh [--wait]
#
# Applies screenshots/cnpg-demo.yaml, then (with --wait) blocks until the demo
# Cluster reports a status phase — same readiness gate the CI smoke test uses.
# Live-metrics shots want more: wait until the instances are Running, e.g.
#   kubectl wait --for=condition=Ready pod -l cnpg.io/cluster=demo-pg -n cnpg-demo --timeout=600s
set -euo pipefail

HERE=$(dirname "$0")
kubectl apply -f "$HERE/cnpg-demo.yaml"

if [[ "${1:-}" == "--wait" ]]; then
  for _ in $(seq 1 30); do
    phase=$(kubectl get cluster demo-pg -n cnpg-demo -o jsonpath='{.status.phase}' 2>/dev/null || true)
    if [[ -n "$phase" ]]; then
      echo "Cluster phase: $phase"
      exit 0
    fi
    sleep 2
  done
  echo 'Timed out waiting for Cluster status' >&2
  kubectl describe cluster demo-pg -n cnpg-demo >&2 || true
  exit 1
fi

echo 'Applied. Cluster instances take a few minutes to become Running.'
