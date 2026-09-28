-- StockDone offline sale idempotency
-- Run after database/migrations/002_security_inventory_hardening.sql
ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_reference UUID;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_business_client_reference ON sales(business_id,client_reference) WHERE client_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_business_invoice ON sales(business_id,invoice_no);
