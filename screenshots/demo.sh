#!/usr/bin/env bash
# Creates the demo cluster used for the README screenshots, fills its logs with sample
# activity, and removes it again. Everything lives in the cnpg-demo namespace.
#
# Usage:
#   screenshots/demo.sh [options] create               # create the demo, add data and log activity
#   screenshots/demo.sh [options] traffic [stage ...]  # add more log activity to the demo
#   screenshots/demo.sh [options] teardown             # delete the demo
#
# 'create' stops if the cnpg-demo namespace already exists.
#
# Options:
#   --context NAME        kubectl context (default: the current one)
#   --storage-class NAME  storage class for the instances (default: the cluster's default)
#   -r, --rounds N        rounds of log activity, 0 for none (default: 1)
#   -i, --interval SEC    pause between rounds (default: 15)
#   -v, --verbose         show psql output, including the expected errors
#   -h, --help
#
# Stages for 'traffic' (default: all):
#   autovacuum connections statements constraints errors locks wal server standby
#
# Examples:
#   screenshots/demo.sh create
#   screenshots/demo.sh create -r 0               # no log activity
#   screenshots/demo.sh traffic -r 6 -i 30        # about 3 minutes of activity
#   screenshots/demo.sh traffic locks errors      # only these stages
#   screenshots/demo.sh teardown
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
MANIFEST="$HERE/cnpg-demo.yaml"

NAMESPACE="cnpg-demo"
CLUSTER="demo-pg-ha"
DB="demo-db"
RO_ROLE="logdemo_readonly"
# teardown only deletes a namespace that has this label.
DEMO_LABEL='app.kubernetes.io/part-of'
DEMO_LABEL_VALUE='cnpg-headlamp-plugin-demo'

CONTEXT=""
STORAGE_CLASS=""
ROUNDS=1
INTERVAL=15
VERBOSE=0
COMMAND=""
ALL_STAGES="autovacuum connections statements constraints errors locks wal server standby"
STAGES=""

usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }
log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --context) CONTEXT="${2:?--context needs a value}"; shift 2 ;;
    --storage-class) STORAGE_CLASS="${2:?--storage-class needs a value}"; shift 2 ;;
    -r|--rounds) ROUNDS="${2:?--rounds needs a value}"; shift 2 ;;
    -i|--interval) INTERVAL="${2:?--interval needs a value}"; shift 2 ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    create|traffic|teardown)
      [ -z "$COMMAND" ] || die "more than one command given ('$COMMAND' and '$1')"
      COMMAND="$1"; shift ;;
    -*) die "unknown option: $1 (see --help)" ;;
    *) STAGES="$STAGES $1"; shift ;;
  esac
done
[ -n "$COMMAND" ] || die "no command given: create, traffic or teardown (see --help)"
[ -z "$STAGES" ] || [ "$COMMAND" = "traffic" ] || die "stages can only be given to 'traffic'"
[ -n "$STAGES" ] || STAGES="$ALL_STAGES"
case "$ROUNDS" in ''|*[!0-9]*) die "--rounds must be a non-negative integer" ;; esac
case "$INTERVAL" in ''|*[!0-9]*) die "--interval must be a non-negative integer" ;; esac
case "$STORAGE_CLASS" in *[!a-zA-Z0-9.-]*) die "--storage-class must be a valid storage class name" ;; esac
for s in $STAGES; do
  case " $ALL_STAGES " in *" $s "*) ;; *) die "unknown stage '$s' (valid: $ALL_STAGES)" ;; esac
done

command -v kubectl >/dev/null || die "kubectl not found"

# kubectl with the chosen context: k for the whole cluster, kc for the demo namespace.
k() {
  if [ -n "$CONTEXT" ]; then kubectl --context "$CONTEXT" "$@"; else kubectl "$@"; fi
}
kc() { k -n "$NAMESPACE" "$@"; }

# Many of these commands fail on purpose, so hide their output unless --verbose.
quiet() { if [ "$VERBOSE" = 1 ]; then "$@" || true; else "$@" >/dev/null 2>&1 || true; fi; }

# Run SQL as the superuser; stop on the first error.
psql_strict() {
  kc exec -i "$PRIMARY" -c postgres -- psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$1" -f -
}
# Run SQL as the superuser; ignore errors.
psql_su() {
  quiet kc exec -i "$PRIMARY" -c postgres -- psql -X -q -U postgres -d "$1" -f -
}
# Run SQL like an app would: log in through the -rw service. Usage: psql_as APPNAME USER PASSWORD DB
psql_as() {
  quiet kc exec -i "$PRIMARY" -c postgres -- \
    env "PGPASSWORD=$3" "PGAPPNAME=$1" psql -X -q -h "$CLUSTER-rw" -U "$2" -d "$4" -f -
}
# Shortcuts for the app user and the read-only user.
as_app() { psql_as "$1" "$APP_USER" "$APP_PASS" "$DB"; }
as_ro() { psql_as "$1" "$RO_ROLE" "$RO_PASS" "$DB"; }

# The context in use.
current_context() {
  if [ -n "$CONTEXT" ]; then echo "$CONTEXT"; else kubectl config current-context 2>/dev/null || echo "unknown"; fi
}

# --- create ---

# The demo manifest. Adds the storage class if one was given, and drops the ScheduledBackup when
# the cluster has no VolumeSnapshot support (the operator rejects it there).
manifest() {
  awk -v sc="$STORAGE_CLASS" -v snapshots="$HAS_SNAPSHOTS" '
    function flush() {
      if (doc != "" && (snapshots == 1 || doc !~ /\nkind: ScheduledBackup\n/)) printf "%s", doc
      doc = ""
    }
    /^---$/ { flush(); doc = "---\n"; next }
    { doc = doc $0 "\n" }
    sc != "" && /^    size: / { doc = doc "    storageClass: " sc "\n" }
    END { flush() }
  ' "$MANIFEST"
}

create_demo() {
  k get crd clusters.postgresql.cnpg.io >/dev/null 2>&1 \
    || die "the CloudNativePG operator is not installed in context $(current_context) (no Cluster CRD)"
  if k get namespace "$NAMESPACE" >/dev/null 2>&1; then
    die "namespace $NAMESPACE already exists in context $(current_context), so there is a demo already. Run 'teardown' first (or 'traffic' to add log events to it)."
  fi

  HAS_SNAPSHOTS=1
  if ! k get crd volumesnapshots.snapshot.storage.k8s.io >/dev/null 2>&1; then
    HAS_SNAPSHOTS=0
    log "No VolumeSnapshot CRD in this cluster, so the demo gets no ScheduledBackup (the operator would reject it)"
  fi

  log "Creating the demo in namespace $NAMESPACE"
  manifest | k create -f - >/dev/null \
    || die "creating the demo failed. Run 'teardown' to remove what was created, then try again."
  note "created"

  log "Waiting for cluster $CLUSTER to be healthy (the first start takes a few minutes)"
  local want ready phase
  want=$(kc get cluster "$CLUSTER" -o jsonpath='{.spec.instances}')
  for _ in $(seq 1 180); do
    ready=$(kc get cluster "$CLUSTER" -o jsonpath='{.status.readyInstances}' 2>/dev/null || true)
    phase=$(kc get cluster "$CLUSTER" -o jsonpath='{.status.phase}' 2>/dev/null || true)
    if [ "${ready:-0}" = "$want" ] && [ "$phase" = "Cluster in healthy state" ]; then
      note "$ready of $want instances ready"
      return
    fi
    sleep 5
  done
  kc describe cluster "$CLUSTER" >&2 || true
  die "cluster $CLUSTER was not healthy after 15 minutes (phase: ${phase:-none}, ready: ${ready:-0}/$want)"
}

wait_for_database() {
  log "Waiting for Database $DB to be applied"
  local applied
  for _ in $(seq 1 60); do
    applied=$(kc get database "$DB" -o jsonpath='{.status.applied}' 2>/dev/null || true)
    [ "$applied" = "true" ] && { note "applied"; return; }
    sleep 2
  done
  die "Database $DB was not applied within 2 minutes: $(kc get database "$DB" -o jsonpath='{.status.message}' 2>/dev/null)"
}

# --- seed ---

load_demo() {
  kc get cluster "$CLUSTER" >/dev/null 2>&1 \
    || die "cluster $NAMESPACE/$CLUSTER not found in context $(current_context); run 'create' first"
  PRIMARY=$(kc get cluster "$CLUSTER" -o jsonpath='{.status.currentPrimary}')
  [ -n "$PRIMARY" ] || die "cluster $CLUSTER has no current primary yet"
  APP_USER=$(kc get secret "$CLUSTER-app" -o jsonpath='{.data.username}' | base64 -d)
  APP_PASS=$(kc get secret "$CLUSTER-app" -o jsonpath='{.data.password}' | base64 -d)
  [ -n "$APP_PASS" ] || die "could not read the app password from secret $CLUSTER-app"
}

# Safe to run twice: tables and data are only created once.
seed_database() {
  log "Adding tables, data, log settings and a read-only user to $DB"
  RO_PASS=$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')
  psql_strict "$DB" <<SQL
SET client_min_messages = warning;
CREATE TABLE IF NOT EXISTS customers (
  id         int PRIMARY KEY,
  email      text NOT NULL UNIQUE,
  name       text NOT NULL,
  country    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS orders (
  id          serial PRIMARY KEY,
  customer_id int NOT NULL REFERENCES customers (id),
  status      text NOT NULL CHECK (status IN ('new', 'paid', 'shipped', 'cancelled')),
  amount      numeric(10, 2) NOT NULL CHECK (amount >= 0),
  region      text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_log (
  id     bigserial PRIMARY KEY,
  at     timestamptz NOT NULL DEFAULT now(),
  actor  text,
  action text
);
ALTER TABLE customers OWNER TO app;
ALTER TABLE orders OWNER TO app;
ALTER TABLE audit_log OWNER TO app;
ALTER SEQUENCE orders_id_seq OWNER TO app;
ALTER SEQUENCE audit_log_id_seq OWNER TO app;

INSERT INTO customers (id, email, name, country)
SELECT g, 'user' || g || '@example.com', 'Customer ' || g,
       (ARRAY['US', 'DE', 'IN', 'BR', 'JP'])[1 + g % 5]
FROM generate_series(1, 1000) g
WHERE NOT EXISTS (SELECT 1 FROM customers);

INSERT INTO orders (customer_id, status, amount, region)
SELECT 1 + g % 1000, (ARRAY['new', 'paid', 'shipped', 'cancelled'])[1 + g % 4],
       round((random() * 500)::numeric, 2), (ARRAY['emea', 'amer', 'apac', 'latam'])[1 + g % 4]
FROM generate_series(1, 50000) g
WHERE NOT EXISTS (SELECT 1 FROM orders);

-- Log settings for this database only.
ALTER DATABASE "$DB" SET log_min_duration_statement = '200ms';
ALTER DATABASE "$DB" SET log_statement = 'ddl';
ALTER DATABASE "$DB" SET log_lock_waits = on;
ALTER DATABASE "$DB" SET deadlock_timeout = '500ms';
ALTER DATABASE "$DB" SET log_temp_files = 0;

-- A read-only user, used to cause "permission denied" errors.
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$RO_ROLE') THEN
    CREATE ROLE $RO_ROLE LOGIN;
  END IF;
END
\$\$;
ALTER ROLE $RO_ROLE PASSWORD '$RO_PASS';
GRANT CONNECT ON DATABASE "$DB" TO $RO_ROLE;
GRANT USAGE ON SCHEMA public TO $RO_ROLE;
GRANT SELECT ON customers, orders TO $RO_ROLE;
REVOKE ALL ON audit_log FROM $RO_ROLE;
SQL
}

# --- stages ---

stage_autovacuum() {
  log "autovacuum: changing many rows so autovacuum runs within about a minute"
  psql_su "$DB" <<SQL
UPDATE orders SET note = md5(random()::text) WHERE id % 2 = 0;
DELETE FROM orders WHERE id > 45000 AND id % 3 = 0;
SQL
}

stage_connections() {
  log "connections: logins, failed logins, stopped and cancelled sessions"
  for app in orders-worker billing-api reporting; do
    as_app "$app" <<<"SELECT 1;"
  done
  # Wrong password, unknown user, unknown database.
  psql_as orders-worker "$APP_USER" "definitely-the-wrong-password" "$DB" <<<"SELECT 1;"
  psql_as orders-worker "$APP_USER" "definitely-the-wrong-password" "$DB" <<<"SELECT 1;"
  psql_as intruder ghost "guess" "$DB" <<<"SELECT 1;"
  psql_as billing-api "$APP_USER" "$APP_PASS" "no_such_database" <<<"SELECT 1;"

  # One long query is stopped by an admin...
  as_app long-report <<<"SELECT pg_sleep(30);" &
  killer_a=$!
  # ...and another one is cancelled.
  as_app nightly-export <<<"SELECT pg_sleep(30);" &
  killer_b=$!
  sleep 2
  psql_su "$DB" <<SQL
SELECT pg_terminate_backend(pid) FROM pg_stat_activity
 WHERE datname = '$DB' AND application_name = 'long-report';
SELECT pg_cancel_backend(pid) FROM pg_stat_activity
 WHERE datname = '$DB' AND application_name = 'nightly-export';
SQL
  wait "$killer_a" "$killer_b" 2>/dev/null || true
}

stage_statements() {
  log "statements: slow queries, a query that spills to disk, schema changes"
  as_app reporting <<SQL
SELECT pg_sleep(0.3);
SELECT pg_sleep(0.7);
SELECT pg_sleep(1.6);
SELECT c.country, o.region, count(*), sum(o.amount)
  FROM generate_series(1, 3000000) g
  JOIN orders o ON o.id = 1 + g % 50000
  JOIN customers c ON c.id = o.customer_id
 GROUP BY 1, 2 ORDER BY 3 DESC;
SET work_mem = '64kB';
SELECT g, md5(g::text) FROM generate_series(1, 300000) g ORDER BY md5(g::text) DESC LIMIT 5;
CREATE INDEX IF NOT EXISTS idx_orders_region_tmp ON orders (region);
DROP INDEX IF EXISTS idx_orders_region_tmp;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS note text;
SQL
}

stage_constraints() {
  log "constraints: unique, foreign key, not-null and check violations"
  as_app orders-worker <<SQL
INSERT INTO customers (id, email, name) VALUES (1, 'dup-pk@example.com', 'Duplicate PK');
INSERT INTO customers (id, email, name)
  VALUES (900001, (SELECT email FROM customers WHERE id = 1), 'Duplicate email');
INSERT INTO orders (customer_id, status, amount) VALUES (999999, 'new', 10);
INSERT INTO orders (customer_id, status, amount) VALUES (1, 'new', NULL);
INSERT INTO orders (customer_id, status, amount) VALUES (1, 'refunded', 10);
INSERT INTO orders (customer_id, status, amount) VALUES (1, 'new', -5);
DELETE FROM customers WHERE id = 1;
SQL
}

stage_errors() {
  log "errors: syntax and permission errors, timeouts, warnings"
  as_app billing-api <<SQL
SELEC * FROM orders;
SELECT * FROM order_items;
SELECT shipping_zip FROM orders LIMIT 1;
SELECT 1 / 0;
SELECT 'not-a-number'::int;
INSERT INTO orders (customer_id, status, amount) VALUES ('x', 'new', 1);
UPDATE customers SET name = repeat('x', 5) WHERE id = 'abc';
DO \$\$ BEGIN RAISE WARNING 'inventory below threshold for sku %', 4217; END \$\$;
DO \$\$ BEGIN RAISE EXCEPTION 'payment provider unreachable (order %)', 31337 USING ERRCODE = 'P0001'; END \$\$;
COMMIT;
BEGIN;
BEGIN;
ROLLBACK;
SET statement_timeout = '300ms';
SELECT pg_sleep(2);
SQL
  # A session left idle too long is closed by the server.
  as_app checkout-service <<SQL
SET idle_in_transaction_session_timeout = '500ms';
BEGIN;
SELECT count(*) FROM orders;
\\! sleep 2
SELECT 1;
SQL
  # The read-only user tries things it is not allowed to do.
  as_ro bi-tool <<SQL
SELECT * FROM audit_log;
INSERT INTO orders (customer_id, status, amount) VALUES (1, 'new', 1);
SELECT count(*) FROM customers;
SQL
}

stage_locks() {
  log "locks: lock waits, a lock timeout and a deadlock"
  # A row is locked by someone else.
  as_app batch-updater <<<"BEGIN; UPDATE orders SET note = 'held by batch-updater' WHERE id = 1; SELECT pg_sleep(2.5); COMMIT;" &
  a=$!
  sleep 0.6
  as_app orders-worker <<<"UPDATE orders SET status = 'paid' WHERE id = 1;"
  wait "$a" 2>/dev/null || true

  # A table is locked by someone else.
  as_app schema-migrator <<<"BEGIN; LOCK TABLE audit_log IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(2.5); COMMIT;" &
  a=$!
  sleep 0.6
  as_app orders-worker <<<"INSERT INTO audit_log (actor, action) VALUES ('app', 'login');"
  wait "$a" 2>/dev/null || true

  # The waiting query gives up.
  as_app batch-updater <<<"BEGIN; UPDATE orders SET note = 'held again' WHERE id = 2; SELECT pg_sleep(2); COMMIT;" &
  a=$!
  sleep 0.6
  as_app billing-api <<<"SET lock_timeout = '300ms'; UPDATE orders SET status = 'shipped' WHERE id = 2;"
  wait "$a" 2>/dev/null || true

  # Two transactions wait for each other (a deadlock).
  as_app worker-a <<<"BEGIN; UPDATE orders SET note = 'a' WHERE id = 10; SELECT pg_sleep(1); UPDATE orders SET note = 'a' WHERE id = 11; COMMIT;" &
  a=$!
  as_app worker-b <<<"BEGIN; UPDATE orders SET note = 'b' WHERE id = 11; SELECT pg_sleep(1); UPDATE orders SET note = 'b' WHERE id = 10; COMMIT;" &
  b=$!
  wait "$a" "$b" 2>/dev/null || true
}

stage_wal() {
  log "wal: a large write, a checkpoint and WAL file switches"
  as_app bulk-loader <<SQL
INSERT INTO orders (customer_id, status, amount, region, note)
SELECT 1 + g % 1000, 'new', round((random() * 300)::numeric, 2), 'emea', md5(g::text)
FROM generate_series(1, 150000) g;
SQL
  psql_su "$DB" <<SQL
CHECKPOINT;
SELECT pg_switch_wal();
SELECT pg_switch_wal();
SQL
}

stage_server() {
  log "server: configuration reload"
  psql_su postgres <<<"SELECT pg_reload_conf();"
}

stage_standby() {
  log "standby: disconnecting one replica so it reconnects"
  psql_su postgres <<<"SELECT pg_terminate_backend(pid) FROM pg_stat_replication ORDER BY application_name LIMIT 1;"
}

# --- commands ---

generate_traffic() {
  local round=1
  while [ "$round" -le "$ROUNDS" ]; do
    [ "$ROUNDS" -gt 1 ] && log "Round $round of $ROUNDS"
    # The primary may change between rounds.
    PRIMARY=$(kc get cluster "$CLUSTER" -o jsonpath='{.status.currentPrimary}')
    for s in $STAGES; do
      "stage_$s"
    done
    round=$((round + 1))
    if [ "$round" -le "$ROUNDS" ]; then
      log "Waiting ${INTERVAL}s before the next round"
      sleep "$INTERVAL"
    fi
  done
}

teardown() {
  local owner
  k get namespace "$NAMESPACE" >/dev/null 2>&1 \
    || die "no namespace $NAMESPACE in context $(current_context), nothing to remove"
  owner=$(k get namespace "$NAMESPACE" -o "jsonpath={.metadata.labels.${DEMO_LABEL//./\\.}}")
  [ "$owner" = "$DEMO_LABEL_VALUE" ] \
    || die "namespace $NAMESPACE was not created by this script (no $DEMO_LABEL=$DEMO_LABEL_VALUE label); delete it yourself if you are sure"
  log "Deleting namespace $NAMESPACE (and with it the Cluster, Pooler, Database and ScheduledBackup)"
  k delete namespace "$NAMESPACE" --wait=true --timeout=300s
}

main() {
  log "Context: $(current_context)"

  case "$COMMAND" in
    teardown)
      teardown
      return
      ;;
    create)
      create_demo
      wait_for_database
      ;;
  esac

  load_demo
  log "Cluster $NAMESPACE/$CLUSTER (primary: $PRIMARY)"
  seed_database
  generate_traffic

  if [ "$ROUNDS" -gt 0 ]; then
    log "Done. Open the cluster in Headlamp and check the Logs tab (autovacuum lines can take ~1 minute to appear)."
  else
    log "Done."
  fi
}

main
