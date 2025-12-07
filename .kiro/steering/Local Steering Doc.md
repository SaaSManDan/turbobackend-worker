---
inclusion: always
---
<!------------------------------------------------------------------------------------
   Add rules to this file or a short description and have Kiro refine them for you.
   
   Learn about inclusion modes: https://kiro.dev/docs/steering/#inclusion-modes
-------------------------------------------------------------------------------------> 
- This project is a Worker that uses Node.js
- Read the generalContext.txt file to understand the general context of the application so you have an understanding of what is being built and make better decisions
- Use the "Postgres Database Tables" section of technicalContext.txt file to reference this project's database schema/structure when creating postgres sql queries
- When I tell you to create a new database table or query, keep in mind, I am referring to Postgres
- Prefix all the db table names in sql queries with the PG_DB_SCHEMA env variable, unless it is a query to create a new column, in that case, put the actual schema in the query.
- The name of the Postgres schema being used for this project is: turbobackend
- If I you provide me a sql query to create a new column or table, add it to the appropriate location in the "Postgres Database Tables" section of the technicalContext.txt file
- I use nano ids for all unique ids, therefore any database columns storing this type of data should be the datatype of varchar. The only exception to this is for user_id (and any references to it), this should be varchar instead
- Also use unix time in seconds for timestamp, so for db columns storing time, use the bigint datatype for that column. Also anytime you capture timestamp in the code, use unix time in seconds.
- If a function contains multiple sql queries, create a transaction