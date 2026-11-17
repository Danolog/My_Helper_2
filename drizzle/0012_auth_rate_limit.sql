CREATE TABLE "auth_rate_limit" (
	"key" "bytea" PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_rate_limit_updated_at_idx" ON "auth_rate_limit" USING btree ("updated_at");
--> statement-breakpoint
-- Dopisane ręcznie: odbiera PUBLIC i roli aplikacji wszystkie prawa do tabeli,
-- także te nadane przez uprawnienia domyślne schematu.
REVOKE ALL ON "auth_rate_limit" FROM PUBLIC, myhelper_app;