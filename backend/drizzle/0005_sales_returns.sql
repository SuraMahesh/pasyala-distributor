CREATE TABLE "sales_return_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"return_id" integer NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" integer NOT NULL,
	"qty" integer NOT NULL,
	"free_qty" integer DEFAULT 0 NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"disc_pct" numeric(5, 2) DEFAULT 0 NOT NULL,
	"line_net" numeric(14, 2) NOT NULL,
	"unit_cost" numeric(14, 4) DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_returns" (
	"id" serial PRIMARY KEY NOT NULL,
	"return_no" text NOT NULL,
	"date" date NOT NULL,
	"customer_id" integer NOT NULL,
	"sales_invoice_id" integer,
	"reason" text DEFAULT 'Other' NOT NULL,
	"restock" boolean DEFAULT true NOT NULL,
	"bill_disc_pct" numeric(5, 2) DEFAULT 0 NOT NULL,
	"gross" numeric(14, 2) NOT NULL,
	"line_discount" numeric(14, 2) NOT NULL,
	"sub_total" numeric(14, 2) NOT NULL,
	"bill_discount" numeric(14, 2) NOT NULL,
	"net_total" numeric(14, 2) NOT NULL,
	"cost_total" numeric(14, 2) DEFAULT 0 NOT NULL,
	"refunded" numeric(14, 2) DEFAULT 0 NOT NULL,
	"refund_method" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_returns_return_no_unique" UNIQUE("return_no"),
	CONSTRAINT "returns_refund_ck" CHECK ("sales_returns"."refunded" >= 0 and "sales_returns"."refunded" <= "sales_returns"."net_total")
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "next_return_no" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_return_id_sales_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sales_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_return_lines" ADD CONSTRAINT "sales_return_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_returns" ADD CONSTRAINT "sales_returns_sales_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("sales_invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "return_lines_return_idx" ON "sales_return_lines" USING btree ("return_id");--> statement-breakpoint
CREATE INDEX "return_lines_product_idx" ON "sales_return_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "returns_date_idx" ON "sales_returns" USING btree ("date");--> statement-breakpoint
CREATE INDEX "returns_customer_idx" ON "sales_returns" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "returns_invoice_idx" ON "sales_returns" USING btree ("sales_invoice_id");