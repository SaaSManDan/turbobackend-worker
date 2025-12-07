-- Backend Project Creation Database Migrations
-- Run these migrations to set up the required database tables

-- Generated Queries Table
CREATE TABLE turbobackend.generated_queries (
  query_id VARCHAR PRIMARY KEY,
  project_id VARCHAR,
  request_id VARCHAR,
  query_text TEXT,
  query_type VARCHAR,
  schema_name VARCHAR,
  execution_status VARCHAR,
  executed_at BIGINT,
  error_message TEXT,
  environment VARCHAR,
  created_at BIGINT
);

-- GitHub Push History Table
CREATE TABLE turbobackend.github_push_history (
  push_id VARCHAR PRIMARY KEY,
  project_id VARCHAR,
  request_id VARCHAR,
  commit_sha VARCHAR,
  commit_message TEXT,
  files_changed JSONB,
  repo_url VARCHAR,
  environment VARCHAR,
  pushed_at BIGINT
);

-- Project GitHub Repositories Table
CREATE TABLE turbobackend.project_github_repos (
  repo_id VARCHAR PRIMARY KEY,
  project_id VARCHAR,
  user_id VARCHAR,
  repo_url VARCHAR,
  repo_name VARCHAR,
  branch VARCHAR DEFAULT 'main',
  access_token_path VARCHAR,
  is_active BOOLEAN DEFAULT true,
  environment VARCHAR,
  created_at BIGINT,
  updated_at BIGINT
);

-- Project Databases Table
CREATE TABLE turbobackend.project_databases (
  database_id VARCHAR PRIMARY KEY,
  project_id VARCHAR,
  user_id VARCHAR,
  db_name VARCHAR,
  db_schema VARCHAR DEFAULT 'public',
  environment VARCHAR,
  is_active BOOLEAN DEFAULT true,
  created_at BIGINT,
  updated_at BIGINT
);

-- Container Sessions Table
CREATE TABLE turbobackend.container_sessions (
  session_id VARCHAR PRIMARY KEY,
  project_id VARCHAR,
  container_id VARCHAR,
  container_provider VARCHAR DEFAULT 'daytona',
  status VARCHAR,
  container_config JSONB,
  environment VARCHAR,
  started_at BIGINT,
  stopped_at BIGINT
);

-- Project Actions Table
CREATE TABLE turbobackend.project_actions (
  action_id VARCHAR PRIMARY KEY,
  project_id VARCHAR,
  user_id VARCHAR,
  request_id VARCHAR,
  action_type VARCHAR,
  action_details VARCHAR,
  status VARCHAR,
  environment VARCHAR,
  reference_ids JSONB,
  created_at BIGINT
);

-- Message Cost Tracker Table
CREATE TABLE turbobackend.message_cost_tracker (
  cost_id VARCHAR PRIMARY KEY,
  project_id VARCHAR,
  job_id VARCHAR,
  user_id VARCHAR,
  prompt_content TEXT,
  message_type VARCHAR,
  model VARCHAR,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd DECIMAL(10, 6),
  time_to_completion INTEGER,
  started_at BIGINT,
  created_at BIGINT
);

-- Project Deployments Table (for Fly.io)
CREATE TABLE turbobackend.project_deployments (
  deployment_id VARCHAR PRIMARY KEY,
  project_id VARCHAR,
  platform VARCHAR,
  app_name VARCHAR,
  url VARCHAR,
  status VARCHAR,
  deployed_at BIGINT,
  last_updated BIGINT
);

-- API Blueprints Table
CREATE TABLE turbobackend.api_blueprints (
  blueprint_id VARCHAR PRIMARY KEY,
  project_id VARCHAR,
  request_id VARCHAR,
  blueprint_content TEXT,
  created_at BIGINT
);

-- ============================================
-- Feature 1: Dynamic Database Provisioning
-- ============================================
-- Note: The project_databases table already supports this feature.
-- When a database is provisioned for a project, it is recorded here.
-- The generated_queries table stores all CREATE TABLE queries executed.
-- No additional migrations needed for Feature 1.

-- ============================================
-- Feature 4: Activity Tracking System
-- ============================================
-- Migration to remove cost_usd column from project_actions table
-- (Cost tracking is handled by message_cost_tracker table)
ALTER TABLE turbobackend.project_actions DROP COLUMN IF EXISTS cost_usd;

-- Add reference_ids column to link activities to related records
ALTER TABLE turbobackend.project_actions ADD COLUMN IF NOT EXISTS reference_ids JSONB;

-- ============================================
-- Feature 5: API Blueprint File Storage
-- ============================================
-- Add last_updated column (keep blueprint_content as VARCHAR)
ALTER TABLE turbobackend.api_blueprints 
ADD COLUMN IF NOT EXISTS last_updated BIGINT;

-- Set last_updated for existing records
UPDATE turbobackend.api_blueprints 
SET last_updated = created_at 
WHERE last_updated IS NULL;

-- ============================================
-- Rename parameter_store_path to credential in cloud_credentials table
-- ============================================
ALTER TABLE turbobackend.cloud_credentials 
RENAME COLUMN parameter_store_path TO credential;
