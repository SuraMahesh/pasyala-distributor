CREATE TABLE "customer_types" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"default_disc_pct" numeric(5, 2) DEFAULT 0 NOT NULL,
	"credit_days" integer DEFAULT 0 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "customer_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type_id" integer NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"disc_pct" numeric(5, 2),
	"credit_limit" numeric(14, 2) DEFAULT 0 NOT NULL,
	"credit_days" integer,
	"notes" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"party_type" text NOT NULL,
	"customer_id" integer,
	"supplier_id" integer,
	"amount" numeric(14, 2) NOT NULL,
	"method" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_party_ck" CHECK (("payments"."party_type" = 'customer' and "payments"."customer_id" is not null and "payments"."supplier_id" is null) or ("payments"."party_type" = 'supplier' and "payments"."supplier_id" is not null and "payments"."customer_id" is null)),
	CONSTRAINT "payments_amount_ck" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "price_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"customer_type_id" integer NOT NULL,
	"price" numeric(14, 2),
	"disc_pct" numeric(5, 2)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"size" text NOT NULL,
	"category" text NOT NULL,
	"list_price" numeric(14, 2) DEFAULT 0 NOT NULL,
	"supplier_disc_pct" numeric(5, 2) DEFAULT 0 NOT NULL,
	"sell_price" numeric(14, 2) DEFAULT 0 NOT NULL,
	"reorder_level" integer DEFAULT 0 NOT NULL,
	"opening_stock" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_code_unique" UNIQUE("code"),
	CONSTRAINT "products_prices_ck" CHECK ("products"."list_price" >= 0 and "products"."sell_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"product_id" integer NOT NULL,
	"customer_type_id" integer,
	"buy_qty" integer NOT NULL,
	"free_qty" integer NOT NULL,
	"start_date" date,
	"end_date" date,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_no" text NOT NULL,
	"supplier_id" integer NOT NULL,
	"order_no" text DEFAULT '' NOT NULL,
	"sales_person" text DEFAULT '' NOT NULL,
	"date" date NOT NULL,
	"pay_method" text NOT NULL,
	"bill_disc_pct" numeric(5, 2) DEFAULT 0 NOT NULL,
	"paid_on_invoice" numeric(14, 2) DEFAULT 0 NOT NULL,
	"gross" numeric(14, 2) NOT NULL,
	"line_discount" numeric(14, 2) NOT NULL,
	"sub_total" numeric(14, 2) NOT NULL,
	"bill_discount" numeric(14, 2) NOT NULL,
	"net_total" numeric(14, 2) NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
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
CREATE TABLE "sales_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_no" text NOT NULL,
	"date" date NOT NULL,
	"customer_id" integer NOT NULL,
	"cost_total" numeric(14, 2) DEFAULT 0 NOT NULL,
	"pay_method" text NOT NULL,
	"bill_disc_pct" numeric(5, 2) DEFAULT 0 NOT NULL,
	"paid_on_invoice" numeric(14, 2) DEFAULT 0 NOT NULL,
	"gross" numeric(14, 2) NOT NULL,
	"line_discount" numeric(14, 2) NOT NULL,
	"sub_total" numeric(14, 2) NOT NULL,
	"bill_discount" numeric(14, 2) NOT NULL,
	"net_total" numeric(14, 2) NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_invoices_invoice_no_unique" UNIQUE("invoice_no")
);
--> statement-breakpoint
CREATE TABLE "sales_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
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
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"invoice_prefix" text DEFAULT 'PJD-' NOT NULL,
	"next_invoice_no" integer DEFAULT 1 NOT NULL,
	"footer_note" text DEFAULT '' NOT NULL,
	"supplier_customer_code" text DEFAULT '' NOT NULL,
	"allow_negative_stock" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"product_id" integer NOT NULL,
	"qty" integer NOT NULL,
	"reason" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"credit_days" integer DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_type_id_customer_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."customer_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_customer_type_id_customer_types_id_fk" FOREIGN KEY ("customer_type_id") REFERENCES "public"."customer_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_customer_type_id_customer_types_id_fk" FOREIGN KEY ("customer_type_id") REFERENCES "public"."customer_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD CONSTRAINT "purchase_invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_invoice_id_purchase_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."purchase_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_lines" ADD CONSTRAINT "sales_lines_invoice_id_sales_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_lines" ADD CONSTRAINT "sales_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_type_idx" ON "customers" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "payments_date_idx" ON "payments" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "price_rules_product_type_uq" ON "price_rules" USING btree ("product_id","customer_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_supplier_invoice_uq" ON "purchase_invoices" USING btree ("supplier_id","invoice_no");--> statement-breakpoint
CREATE INDEX "purchase_date_idx" ON "purchase_invoices" USING btree ("date");--> statement-breakpoint
CREATE INDEX "purchase_lines_invoice_idx" ON "purchase_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "purchase_lines_product_idx" ON "purchase_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "sales_date_idx" ON "sales_invoices" USING btree ("date");--> statement-breakpoint
CREATE INDEX "sales_customer_idx" ON "sales_invoices" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "sales_lines_invoice_idx" ON "sales_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "sales_lines_product_idx" ON "sales_lines" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "adj_product_idx" ON "stock_adjustments" USING btree ("product_id");