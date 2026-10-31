#!/usr/bin/env bash
set -eu
# Passwords arrive through the container environment; never enable shell tracing.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=migrator_password="$MIGRATOR_PASSWORD" --set=runtime_password="$RUNTIME_PASSWORD" <<'SQL'
CREATE ROLE craftlayer_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD :'migrator_password';
CREATE ROLE craftlayer_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD :'runtime_password';
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO craftlayer_migrator;
GRANT USAGE ON SCHEMA public TO craftlayer_runtime;
REVOKE ALL ON DATABASE craftlayer FROM PUBLIC;
GRANT CONNECT ON DATABASE craftlayer TO craftlayer_migrator, craftlayer_runtime;
SQL
