-- Create the auth database if it doesn't already exist.
-- This runs as part of postgres docker-entrypoint-initdb.d on first init.
SELECT 'CREATE DATABASE auth_migrateck OWNER migra'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_migrateck')\gexec

-- Enable citext extension in the auth database
\c auth_migrateck
CREATE EXTENSION IF NOT EXISTS citext;
