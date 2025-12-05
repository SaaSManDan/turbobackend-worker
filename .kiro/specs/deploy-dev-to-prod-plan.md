- Deploy github from dev (my gh account) to prod (user's github account)
- Spin up resources, same as dev, for prod to host user's backend
- Spin up db on user's cloud provider and migrate sql query from dev db (on my server) to prod db
- ensure the data for each resource created is stored in appropriate db table and set "environment" column to "prod"

- Figure out a way for users to add a custom domain for their backend application
- get the keys for each cloud provider from AWS Parameter Store SecureString, first get the location of the key from our db