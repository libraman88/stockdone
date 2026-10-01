-- StockDone offline return/exchange idempotency
-- Run after database/migrations/004_return_accounting.sql
ALTER TABLE returns ADD COLUMN IF NOT EXISTS client_reference TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_returns_business_client_reference ON returns(business_id,client_reference) WHERE client_reference IS NOT NULL;
