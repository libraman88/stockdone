-- StockDone return accounting hardening
-- Run after database/migrations/003_offline_idempotency.sql (the deprecated duplicate 003_offline_sale_idempotency.sql is a no-op)
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS return_payments (id UUID PRIMARY KEY,business_id UUID NOT NULL REFERENCES businesses(id),branch_id UUID NOT NULL REFERENCES branches(id),return_id UUID NOT NULL REFERENCES returns(id),method TEXT NOT NULL CHECK(method IN ('cash','card','bank','other')),direction TEXT NOT NULL CHECK(direction IN ('refund','received')),amount NUMERIC(12,2) NOT NULL CHECK(amount > 0),created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_return_payments_return ON return_payments(return_id,created_at DESC);
