-- Create a read-only role for the user-facing SQL query endpoint (local dev).
CREATE ROLE siu_readonly WITH LOGIN PASSWORD 'siu_readonly';
GRANT CONNECT ON DATABASE siu TO siu_readonly;
GRANT USAGE ON SCHEMA public TO siu_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO siu_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO siu_readonly;
