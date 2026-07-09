CREATE TABLE "model_provider_config" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text DEFAULT 'Custom Provider' NOT NULL,
	"base_url" text,
	"api_key" text,
	"model_id" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
