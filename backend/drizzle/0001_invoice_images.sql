CREATE TABLE "invoice_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"sales_invoice_id" integer,
	"purchase_invoice_id" integer,
	"page" integer DEFAULT 1 NOT NULL,
	"storage" text NOT NULL,
	"path" text NOT NULL,
	"thumb_path" text NOT NULL,
	"mime_type" text DEFAULT 'image/jpeg' NOT NULL,
	"size" integer NOT NULL,
	"width" integer DEFAULT 0 NOT NULL,
	"height" integer DEFAULT 0 NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_images_one_invoice" CHECK (("invoice_images"."sales_invoice_id" is null) <> ("invoice_images"."purchase_invoice_id" is null))
);
--> statement-breakpoint
ALTER TABLE "invoice_images" ADD CONSTRAINT "invoice_images_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_images" ADD CONSTRAINT "invoice_images_purchase_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("purchase_invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_images_sha_uq" ON "invoice_images" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "invoice_images_sale_idx" ON "invoice_images" USING btree ("sales_invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_images_purchase_idx" ON "invoice_images" USING btree ("purchase_invoice_id");