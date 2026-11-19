#!/usr/bin/env bash
# Creates a Kubernetes client-certificate user bound to a Role/ClusterRole of your choice against
# whatever cluster the current kubectl context points at, and adds a kubectl context to connect as
# that user. Meant for exercising this plugin's RBAC-aware UI against a local kind cluster without
# needing a second cluster.
#
# Usage:
#   scripts/create-context.sh                                # built-in read-only ClusterRole
#   scripts/create-context.sh --clusterrole NAME             # bind to an existing ClusterRole
#   scripts/create-context.sh --role NAME --namespace NS     # bind to an existing namespaced Role
#   scripts/create-context.sh --clusterrole NAME -n NS       # ClusterRole, scoped to one namespace
#   scripts/create-context.sh [options] --delete             # remove what this script created
#
# Options:
#   --clusterrole NAME   existing ClusterRole to bind to
#   --role NAME          existing Role to bind to (requires --namespace)
#   -n, --namespace NS   namespace for a RoleBinding (default: ClusterRoleBinding)
#   --user NAME          kubeconfig user / certificate CN (default: <role>-user)
#   --context NAME       kubeconfig context name (default: <role>)
#   --delete             tear down; pass the same role options used at creation
#
# With no --role/--clusterrole, the script creates and binds a "readonly-viewer" ClusterRole
# (get/list/watch on everything). Roles passed in explicitly are never created or deleted.
set -euo pipefail

ROLE_KIND=""
ROLE_NAME=""
NAMESPACE=""
USER_NAME=""
CONTEXT_NAME=""
DELETE=false

usage() {
  sed -n '2,/^set -/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clusterrole)
      ROLE_KIND=ClusterRole
      ROLE_NAME="${2:?--clusterrole needs a value}"
      shift 2
      ;;
    --role)
      ROLE_KIND=Role
      ROLE_NAME="${2:?--role needs a value}"
      shift 2
      ;;
    -n | --namespace)
      NAMESPACE="${2:?--namespace needs a value}"
      shift 2
      ;;
    --user)
      USER_NAME="${2:?--user needs a value}"
      shift 2
      ;;
    --context)
      CONTEXT_NAME="${2:?--context needs a value}"
      shift 2
      ;;
    --delete)
      DELETE=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

# No role given: fall back to the built-in read-only ClusterRole, which this script owns.
BUILTIN=false
if [[ -z "$ROLE_NAME" ]]; then
  BUILTIN=true
  ROLE_KIND=ClusterRole
  ROLE_NAME="readonly-viewer"
  BINDING_NAME="readonly-viewer-binding"
  : "${USER_NAME:=readonly-user}"
  : "${CONTEXT_NAME:=readonly}"
fi

if [[ "$ROLE_KIND" == "Role" && -z "$NAMESPACE" ]]; then
  echo "--role requires --namespace." >&2
  exit 1
fi

: "${USER_NAME:=$ROLE_NAME-user}"
: "${CONTEXT_NAME:=$ROLE_NAME}"
: "${BINDING_NAME:=$USER_NAME-$ROLE_NAME}"

# A namespace always means a RoleBinding (it can reference either kind of role); otherwise cluster-wide.
if [[ -n "$NAMESPACE" ]]; then
  BINDING_KIND=RoleBinding
  NS_ARGS=(-n "$NAMESPACE")
  NS_LINE="  namespace: $NAMESPACE"
else
  BINDING_KIND=ClusterRoleBinding
  NS_ARGS=()
  NS_LINE=""
fi

for cmd in kubectl openssl base64; do
  command -v "$cmd" >/dev/null || {
    echo "Required command not found: $cmd" >&2
    exit 1
  }
done

CURRENT_CONTEXT=$(kubectl config current-context)
CLUSTER_NAME=$(kubectl config view -o jsonpath="{.contexts[?(@.name==\"$CURRENT_CONTEXT\")].context.cluster}")

echo "Target cluster : $CLUSTER_NAME"
echo "Current context: $CURRENT_CONTEXT"
if [[ "$CURRENT_CONTEXT" != kind-* ]]; then
  echo "Warning: current context doesn't look like a kind cluster (expected a 'kind-*' name)." >&2
fi
echo

if [[ "$DELETE" == true ]]; then
  echo "==> Removing kubeconfig context and credentials"
  kubectl config delete-context "$CONTEXT_NAME" 2>/dev/null || true
  kubectl config unset "users.$USER_NAME" >/dev/null 2>&1 || true

  echo "==> Deleting $BINDING_KIND and any leftover CSR"
  kubectl delete "$BINDING_KIND" "$BINDING_NAME" "${NS_ARGS[@]}" --ignore-not-found
  kubectl delete csr "$USER_NAME" --ignore-not-found
  if [[ "$BUILTIN" == true ]]; then
    echo "==> Deleting built-in ClusterRole '$ROLE_NAME'"
    kubectl delete clusterrole "$ROLE_NAME" --ignore-not-found
  fi

  echo "Done."
  exit 0
fi

# Fail fast on a typo'd role instead of leaving behind a user that can do nothing.
if [[ "$BUILTIN" == false ]]; then
  kubectl get "$ROLE_KIND" "$ROLE_NAME" "${NS_ARGS[@]}" >/dev/null || {
    echo "$ROLE_KIND '$ROLE_NAME' not found." >&2
    exit 1
  }
fi

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

echo "==> Generating client key + CSR for user '$USER_NAME'"
openssl genrsa -out "$WORKDIR/$USER_NAME.key" 2048 >/dev/null 2>&1
openssl req -new -key "$WORKDIR/$USER_NAME.key" -out "$WORKDIR/$USER_NAME.csr" -subj "/CN=$USER_NAME"

echo "==> Submitting and approving the CertificateSigningRequest"
kubectl delete csr "$USER_NAME" --ignore-not-found
kubectl apply -f - <<EOF
apiVersion: certificates.k8s.io/v1
kind: CertificateSigningRequest
metadata:
  name: $USER_NAME
spec:
  request: $(base64 <"$WORKDIR/$USER_NAME.csr" | tr -d '\n')
  signerName: kubernetes.io/kube-apiserver-client
  expirationSeconds: 31536000
  usages:
    - client auth
EOF
kubectl certificate approve "$USER_NAME"

echo "==> Waiting for the signed certificate"
CERT=""
for _ in $(seq 1 30); do
  CERT=$(kubectl get csr "$USER_NAME" -o jsonpath='{.status.certificate}')
  [[ -n "$CERT" ]] && break
  sleep 1
done
if [[ -z "$CERT" ]]; then
  echo "Timed out waiting for the CSR to be signed." >&2
  exit 1
fi
echo "$CERT" | base64 -d >"$WORKDIR/$USER_NAME.crt"

if [[ "$BUILTIN" == true ]]; then
  echo "==> Creating ClusterRole '$ROLE_NAME' (get/list/watch on all resources)"
  kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: $ROLE_NAME
rules:
  - apiGroups: ["*"]
    resources: ["*"]
    verbs: ["get", "list", "watch"]
  - nonResourceURLs: ["*"]
    verbs: ["get"]
EOF
fi

echo "==> Binding '$USER_NAME' to $ROLE_KIND '$ROLE_NAME' via $BINDING_KIND '$BINDING_NAME'"
kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: $BINDING_KIND
metadata:
  name: $BINDING_NAME
$NS_LINE
subjects:
  - kind: User
    name: $USER_NAME
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: $ROLE_KIND
  name: $ROLE_NAME
  apiGroup: rbac.authorization.k8s.io
EOF

echo "==> Adding '$USER_NAME' credentials and '$CONTEXT_NAME' context to kubeconfig"
kubectl config set-credentials "$USER_NAME" \
  --client-certificate="$WORKDIR/$USER_NAME.crt" \
  --client-key="$WORKDIR/$USER_NAME.key" \
  --embed-certs=true
kubectl config set-context "$CONTEXT_NAME" \
  --cluster="$CLUSTER_NAME" \
  --user="$USER_NAME"

echo
echo "Done. Switch to the new context with:"
echo "  kubectl config use-context $CONTEXT_NAME"
echo "Switch back with:"
echo "  kubectl config use-context $CURRENT_CONTEXT"
echo "Tear everything down with:"
echo "  $0 ${*:-} --delete"
