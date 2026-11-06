ALTER TABLE "purchase_invoices" ADD COLUMN "cheque_no" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_invoices" ADD COLUMN "cheque_date" date;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "cheque_no" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_invoices" ADD COLUMN "cheque_date" date;