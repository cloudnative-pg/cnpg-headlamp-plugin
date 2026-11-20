#!/usr/bin/env bash
# Generates a mix of PostgreSQL log events on a CloudNativePG cluster so the plugin's Logs tab has
# something to show: connections, slow statements, constraint violations, application errors, lock
# waits and deadlocks, WAL, autovacuum, standby and server events.
#
# It creates (all removed by `teardown`): a declarative Database (default <cluster>-logdemo) with
# demo data, a login role `logdemo_readonly`, and three logging parameters patched into the
# Cluster's spec.postgresql.parameters (log_connections, log_disconnections,
# log_autovacuum_min_duration; Postgres can't set them per database). Everything else is set with
# ALTER DATABASE on the demo database only.
#
# Usage:
#   scripts/generate-pg-logs.sh [options] [run [stage ...]]   # default command
#   scripts/generate-pg-logs.sh [options] teardown
#
# Stages (default: all, in this order):
#   autovacuum connections statements constraints errors locks wal server standby
#
# Options:
#   --context NAME      kubectl context            (default: current context)
#   -n, --namespace NS  namespace of the cluster   (default: default)
#   -c, --cluster NAME  CNPG cluster name          (default: demo1)
#   -d, --database DB   demo database name         (default: logdemo)
#   -r, --rounds N      repeat the stages N times  (default: 1)
#   -i, --interval SEC  pause between rounds       (default: 15)
#   -v, --verbose       show psql output, including the (intentional) errors
#   -h, --help
#
# Examples:
#   scripts/generate-pg-logs.sh                               # one round of everything
#   scripts/generate-pg-logs.sh -r 6 -i 30                    # ~3 minutes of varied traffic
#   scripts/generate-pg-logs.sh run locks errors              # only those stages
#   scripts/generate-pg-logs.sh -n prod -c pg-main teardown   # remove everything it created
set -euo pipefail

CONTEXT=""
NAMESPACE="default"
CLUSTER="demo1"
DB="logdemo"
ROUNDS=1
INTERVAL=15
VERBOSE=0
COMMAND="run"
ALL_STAGES="autovacuum connections statements constraints errors locks wal server standby"
STAGES=""
RO_ROLE="logdemo_readonly"

usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }
log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --context) CONTEXT="$2"; shift 2 ;;
    -n|--namespace) NAMESPACE="$2"; shift 2 ;;
    -c|--cluster) CLUSTER="$2"; shift 2 ;;
    -d|--database) DB="$2"; shift 2 ;;
    -r|--rounds) ROUNDS="$2"; shift 2 ;;
    -i|--interval) INTERVAL="$2"; shift 2 ;;
    -v|--verbose) VERBOSE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    run) COMMAND="run"; shift ;;
    teardown) COMMAND="teardown"; shift ;;
    -*) die "unknown option: $1 (see --help)" ;;
    *) STAGES="$STAGES $1"; shift ;;
  esac
done
[ -n "$STAGES" ] || STAGES="$ALL_STAGES"
case "$ROUNDS" in ''|*[!0-9]*) die "--rounds must be a positive integer" ;; esac
[ "$ROUNDS" -ge 1 ] || die "--rounds must be a positive integer"
for s in $STAGES; do
  case " $ALL_STAGES " in *" $s "*) ;; *) die "unknown stage '$s' (valid: $ALL_STAGES)" ;; esac
done

command -v kubectl >/dev/null || die "kubectl not found"

# kubectl scoped to the chosen context and namespace. A function, not an array: empty arrays break
# under `set -u` on macOS's bash 3.2.
kc() {
  if [ -n "$CONTEXT" ]; then
    kubectl --context "$CONTEXT" -n "$NAMESPACE" "$@"
  else
    kubectl -n "$NAMESPACE" "$@"
  fi
}

DB_CR="$CLUSTER-$DB"
RW_HOST="$CLUSTER-rw"

# The scenarios fail on purpose, so psql's output is hidden unless --verbose.
quiet() { if [ "$VERBOSE" = 1 ]; then "$@" || true; else "$@" >/dev/null 2>&1 || true; fi; }

# psql_strict DB < sql: superuser over the unix socket; stops on error.
psql_strict() {
  kc exec -i "$PRIMARY" -c postgres -- psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$1" -f -
}
# psql_su DB < sql: same, but errors are tolerated.
psql_su() {
  quiet kc exec -i "$PRIMARY" -c postgres -- psql -X -q -U postgres -d "$1" -f -
}
# psql_as APPNAME USER PASSWORD DB < sql: a real TLS client through the -rw service, so connections
# and application_name show up in the log as a client's would.
psql_as() {
  quiet kc exec -i "$PRIMARY" -c postgres -- \
    env "PGPASSWORD=$3" "PGAPPNAME=$1" psql -X -q -h "$RW_HOST" -U "$2" -d "$4" -f -
}
# Shortcuts for the demo app user and the read-only role.
as_app() { psql_as "$1" "$APP_USER" "$APP_PASS" "$DB"; }
as_ro() { psql_as "$1" "$RO_ROLE" "$RO_PASS" "$DB"; }

load_cluster() {
  kc get cluster "$CLUSTER" >/dev/null 2>&1 || die "cluster $NAMESPACE/$CLUSTER not found (context: ${CONTEXT:-current})"
  PRIMARY=$(kc get cluster "$CLUSTER" -o jsonpath='{.status.currentPrimary}')
  [ -n "$PRIMARY" ] || die "cluster $CLUSTER has no current primary yet"
}

# --- setup ---

patch_logging_parameters() {
  log "Enabling connection + autovacuum logging on the cluster (spec.postgresql.parameters)"
  kc patch cluster "$CLUSTER" --type merge -p \
    '{"spec":{"postgresql":{"parameters":{"log_connections":"on","log_disconnections":"on","log_autovacuum_min_duration":"0"}}}}' >/dev/null
  # CNPG reloads the config within a few seconds; wait until new sessions would honour it.
  for _ in $(seq 1 40); do
    v=$(kc exec "$PRIMARY" -c postgres -- psql -X -At -U postgres -d postgres \
      -c "SELECT current_setting('log_disconnections') = 'on' AND current_setting('log_autovacuum_min_duration') = '0'" 2>/dev/null || true)
    [ "$v" = "t" ] && { note "applied"; return; }
    sleep 2
  done
  note "parameters not visible yet; continuing anyway (CNPG may still be reloading)"
}

ensure_database() {
  log "Ensuring Database CR $NAMESPACE/$DB_CR (database '$DB', owner app)"
  kc apply -f - >/dev/null <<EOF
apiVersion: postgresql.cnpg.io/v1
kind: Database
metadata:
  name: $DB_CR
spec:
  cluster:
    name: $CLUSTER
  name: $DB
  owner: app
  databaseReclaimPolicy: delete
EOF
  for _ in $(seq 1 60); do
    applied=$(kc get database "$DB_CR" -o jsonpath='{.status.applied}' 2>/dev/null || true)
    [ "$applied" = "true" ] && { note "database is ready"; return; }
    sleep 2
  done
  die "Database $DB_CR was not applied within 2 minutes: $(kc get database "$DB_CR" -o jsonpath='{.status.message}' 2>/dev/null)"
}

seed_database() {
  log "Seeding schema, data, per-database log settings and the read-only role"
  # (`head` first, so no pipe is closed early and `pipefail` stays quiet.)
  RO_PASS=$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')
  psql_strict "$DB" <<SQL
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

-- Per-database logging: only sessions in this database are affected.
ALTER DATABASE "$DB" SET log_min_duration_statement = '200ms';
ALTER DATABASE "$DB" SET log_statement = 'ddl';
ALTER DATABASE "$DB" SET log_lock_waits = on;
ALTER DATABASE "$DB" SET deadlock_timeout = '500ms';
ALTER DATABASE "$DB" SET log_temp_files = 0;

-- Read-only role used to provoke "permission denied" errors. Fresh random password every run.
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

load_credentials() {
  APP_USER=$(kc get secret "$CLUSTER-app" -o jsonpath='{.data.username}' | base64 -d)
  APP_PASS=$(kc get secret "$CLUSTER-app" -o jsonpath='{.data.password}' | base64 -d)
  [ -n "$APP_PASS" ] || die "could not read the app password from secret $CLUSTER-app"
}

# --- stages ---

stage_autovacuum() {
  log "autovacuum: churning 'orders' so autovacuum + autoanalyze fire within ~1 minute"
  psql_su "$DB" <<SQL
UPDATE orders SET note = md5(random()::text) WHERE id % 2 = 0;
DELETE FROM orders WHERE id > 45000 AND id % 3 = 0;
SQL
}

stage_connections() {
  log "connections: authorized sessions, failed logins, killed and cancelled sessions"
  for app in orders-worker billing-api reporting; do
    as_app "$app" <<<"SELECT 1;"
  done
  # Authentication failures + a database that does not exist (FATAL).
  psql_as orders-worker "$APP_USER" "definitely-the-wrong-password" "$DB" <<<"SELECT 1;"
  psql_as orders-worker "$APP_USER" "definitely-the-wrong-password" "$DB" <<<"SELECT 1;"
  psql_as intruder ghost "guess" "$DB" <<<"SELECT 1;"
  psql_as billing-api "$APP_USER" "$APP_PASS" "no_such_database" <<<"SELECT 1;"

  # A long-running report gets killed by an admin (FATAL: terminating connection ...).
  as_app long-report <<<"SELECT pg_sleep(30);" &
  killer_a=$!
  # ...and another one is cancelled (ERROR: canceling statement due to user request).
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
  log "statements: slow queries, a temp-file spill and DDL"
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
  log "errors: syntax/undefined/permission errors, timeouts, warnings"
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
  # Session killed by idle_in_transaction_session_timeout (FATAL).
  as_app checkout-service <<SQL
SET idle_in_transaction_session_timeout = '500ms';
BEGIN;
SELECT count(*) FROM orders;
\\! sleep 2
SELECT 1;
SQL
  # permission denied: the read-only role against tables it was never granted.
  as_ro bi-tool <<SQL
SELECT * FROM audit_log;
INSERT INTO orders (customer_id, status, amount) VALUES (1, 'new', 1);
SELECT count(*) FROM customers;
SQL
}

stage_locks() {
  log "locks: lock waits, a lock timeout and a deadlock"
  # 1) row-lock wait behind an open transaction
  as_app batch-updater <<<"BEGIN; UPDATE orders SET note = 'held by batch-updater' WHERE id = 1; SELECT pg_sleep(2.5); COMMIT;" &
  a=$!
  sleep 0.6
  as_app orders-worker <<<"UPDATE orders SET status = 'paid' WHERE id = 1;"
  wait "$a" 2>/dev/null || true

  # 2) relation-level lock wait
  as_app schema-migrator <<<"BEGIN; LOCK TABLE audit_log IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(2.5); COMMIT;" &
  a=$!
  sleep 0.6
  as_app orders-worker <<<"INSERT INTO audit_log (actor, action) VALUES ('app', 'login');"
  wait "$a" 2>/dev/null || true

  # 3) lock timeout: the waiter gives up
  as_app batch-updater <<<"BEGIN; UPDATE orders SET note = 'held again' WHERE id = 2; SELECT pg_sleep(2); COMMIT;" &
  a=$!
  sleep 0.6
  as_app billing-api <<<"SET lock_timeout = '300ms'; UPDATE orders SET status = 'shipped' WHERE id = 2;"
  wait "$a" 2>/dev/null || true

  # 4) deadlock: two transactions update rows 10 and 11 in opposite order
  as_app worker-a <<<"BEGIN; UPDATE orders SET note = 'a' WHERE id = 10; SELECT pg_sleep(1); UPDATE orders SET note = 'a' WHERE id = 11; COMMIT;" &
  a=$!
  as_app worker-b <<<"BEGIN; UPDATE orders SET note = 'b' WHERE id = 11; SELECT pg_sleep(1); UPDATE orders SET note = 'b' WHERE id = 10; COMMIT;" &
  b=$!
  wait "$a" "$b" 2>/dev/null || true
}

stage_wal() {
  log "wal: bulk write, forced checkpoint and WAL segment switches"
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
  log "standby: dropping one WAL sender so a replica logs the disconnect and re-streams"
  psql_su postgres <<<"SELECT pg_terminate_backend(pid) FROM pg_stat_replication ORDER BY application_name LIMIT 1;"
}

# --- teardown ---

teardown() {
  load_cluster
  log "Deleting Database CR $DB_CR (databaseReclaimPolicy: delete drops the database)"
  kc delete database "$DB_CR" --ignore-not-found --wait=true --timeout=120s
  log "Dropping role $RO_ROLE"
  psql_su postgres <<<"DROP ROLE IF EXISTS $RO_ROLE;"
  log "Removing the logging parameters this script added to the cluster"
  kc patch cluster "$CLUSTER" --type merge -p \
    '{"spec":{"postgresql":{"parameters":{"log_connections":null,"log_disconnections":null,"log_autovacuum_min_duration":null}}}}' >/dev/null
  note "done"
}

main() {
  if [ "$COMMAND" = "teardown" ]; then
    teardown
    return
  fi

  load_cluster
  log "Cluster $NAMESPACE/$CLUSTER (primary: $PRIMARY, context: ${CONTEXT:-$(kubectl config current-context)})"
  patch_logging_parameters
  ensure_database
  load_credentials
  seed_database

  round=1
  while [ "$round" -le "$ROUNDS" ]; do
    [ "$ROUNDS" -gt 1 ] && log "Round $round of $ROUNDS"
    # The primary can change between rounds (switchover/failover), so re-read it.
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

  log "Done. Open the cluster in Headlamp and check the Logs tab (autovacuum lines can take ~1 minute to appear)."
}

main
