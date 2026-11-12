CREATE TABLE "discord_guilds" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"role_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_link_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"discord_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_links" (
	"user_id" text PRIMARY KEY NOT NULL,
	"discord_id" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discord_links_discord_id_unique" UNIQUE("discord_id")
);
--> statement-breakpoint
ALTER TABLE "discord_links" ADD CONSTRAINT "discord_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;