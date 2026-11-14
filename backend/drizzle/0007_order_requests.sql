CREATE TABLE "order_request_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" integer NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" integer,
	"name" text NOT NULL,
	"size" text DEFAULT '' NOT NULL,
	"qty" integer NOT NULL,
	"unit_price" numeric(14, 2),
	"notes" text DEFAULT '' NOT NULL,
	CONSTRAINT "order_request_lines_qty_check" CHECK ("order_request_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "order_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_no" text NOT NULL,
	"supplier_id" integer NOT NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"show_prices" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_requests_request_no_unique" UNIQUE("request_no")
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "next_order_no" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_request_lines" ADD CONSTRAINT "order_request_lines_request_id_order_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."order_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_request_lines" ADD CONSTRAINT "order_request_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_requests" ADD CONSTRAINT "order_requests_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_request_lines_request_idx" ON "order_request_lines" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "order_requests_date_idx" ON "order_requests" USING btree ("date");--> statement-breakpoint
CREATE INDEX "order_requests_supplier_idx" ON "order_requests" USING btree ("supplier_id");