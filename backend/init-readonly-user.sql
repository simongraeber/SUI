-- Create a read-only PostgreSQL role for the user-facing SQL query endpoint.
-- This script is idempotent — safe to run multiple times.
-- Usage: docker exec -i siu-postgres psql -U siu -d siu < init-readonly-user.sql

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'siu_readonly') THEN
    CREATE ROLE siu_readonly WITH LOGIN PASSWORD '18c9834fb3d4159e5d000ced4819f519';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE siu TO siu_readonly;
GRANT USAGE ON SCHEMA public TO siu_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO siu_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO siu_readonly;
