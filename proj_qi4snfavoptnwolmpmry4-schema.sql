-- -------------------------------------------------------------
-- TablePlus 6.7.8(650)
--
-- https://tableplus.com/
--
-- Database: turbobackend_proj_qi4snfavoptnwolmpmry4
-- Generation Time: 2025-12-07 01:49:59.1530
-- -------------------------------------------------------------


DROP TABLE IF EXISTS "public"."users";
-- Table Definition
CREATE TABLE "public"."users" (
    "user_id" varchar NOT NULL,
    "email" varchar NOT NULL,
    "password_hash" varchar NOT NULL,
    "name" varchar NOT NULL,
    "created_at" int8 NOT NULL,
    "updated_at" int8 NOT NULL,
    PRIMARY KEY ("user_id")
);

DROP TABLE IF EXISTS "public"."workouts";
-- Table Definition
CREATE TABLE "public"."workouts" (
    "workout_id" varchar NOT NULL,
    "user_id" varchar NOT NULL,
    "workout_date" int8 NOT NULL,
    "name" varchar NOT NULL,
    "duration" int4,
    "created_at" int8 NOT NULL,
    PRIMARY KEY ("workout_id")
);

DROP TABLE IF EXISTS "public"."exercise_logs";
-- Table Definition
CREATE TABLE "public"."exercise_logs" (
    "log_id" varchar NOT NULL,
    "workout_id" varchar NOT NULL,
    "exercise_name" varchar NOT NULL,
    "sets" int4 NOT NULL,
    "reps" int4,
    "weight" numeric(5,2),
    "notes" text,
    "created_at" int8 NOT NULL,
    PRIMARY KEY ("log_id")
);



-- Indices
CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);
ALTER TABLE "public"."workouts" ADD FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id");
ALTER TABLE "public"."exercise_logs" ADD FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("workout_id");
