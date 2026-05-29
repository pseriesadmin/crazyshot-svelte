-- ★ MIGRATION: 01_extensions.sql
-- Schema version: v5.46
-- Description: PostgreSQL extensions required for Crazyshot
-- Dependencies: None
-- Author: Stephen Cconzy
-- Date: 2026-05-29

-- Must enable first for full functionality
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "moddatetime";
CREATE EXTENSION IF NOT EXISTS "pg_cron";

-- Verify all extensions are installed
SELECT extname FROM pg_extension ORDER BY extname;
