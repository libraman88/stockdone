-- Offline sale replay safety
-- Allows an offline sale to be retried safely without creating a duplicate.
ALTER TABLE sales ADD COLUMN IF NOT EXISTS client_reference TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_business_client_reference
ON sales(business_id, client_reference)
WHERE client_reference IS NOT NULL;
