#!/usr/bin/env bash
# Creates a cluster-wide read-only Kubernetes user (get/list/watch on every resource) against
# whatever cluster the current kubectl context points at, and adds a "readonly" kubectl context
# to connect as that user. Meant for exercising this plugin's RBAC-aware UI (disabled Create
# buttons, hidden Edit/Delete) against a local kind cluster without needing a second cluster.
#
# Thin wrapper around create-context.sh, whose default (no role given) is exactly this preset.
#
# Usage:
#   scripts/create-readonly-context.sh            # create the user, RBAC, and context
#   scripts/create-readonly-context.sh --delete    # remove everything this script created
set -euo pipefail

exec "$(dirname "$0")/create-context.sh" --user readonly-user --context readonly "$@"
