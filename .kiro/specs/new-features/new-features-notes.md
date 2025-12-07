#  New Features Spec

## Feature 1: Dynamic Database Provisioning Tool

Add a tool to the AI in the MCP request processor that:
- Determines if a relational database (Postgres) is necessary for a new application
- When called, executes a function that:
  - Takes in the prompt
  - Feeds it to AI to design tables
  - Writes queries to create the tables
  - Spins up a database in the cluster
  - Uses the queries to create the tables

## Feature 2: Project Modification Processor

Create a new processor that handles modification requests to existing projects:
- Creating/adding new endpoints
- Modifying business logic in existing endpoints
- Adding new database tables
- Other project modifications

## Feature 3: Dev to Prod Deployment Processor

Create a processor to handle deploying resources from dev environment to production:
- Deploy database schema changes to production database
- Deploy application code to production infrastructure
- Migrate environment-specific configurations
- Handle rollback capabilities

## Feature 4: Activity Tracking System

Create a function to track and log user/project activities:
- Project created
- New API endpoints added
- Database created
- Database queries executed
- Deployments (dev/prod)
- Code modifications
- Infrastructure changes
- Other significant events
