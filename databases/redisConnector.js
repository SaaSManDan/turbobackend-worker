import Redis from "ioredis";

export const redis = new Redis({
    host: process.env.NODE_ENV === "production" 
        ? process.env.REDIS_HOST_URL 
        : "localhost",
    port: process.env.NODE_ENV === "production"
        ? process.env.REDIS_PORT
        : 6379,
    ...(process.env.NODE_ENV === "production" && {
        username: process.env.REDIS_USER,
        password: process.env.REDIS_PASSWORD,
        tls: {
            rejectUnauthorized: false
        }
    }),
    maxRetriesPerRequest: null
});