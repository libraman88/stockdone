-- StockDone database backup metadata
CREATE TABLE IF NOT EXISTS backup_metadata (id UUID PRIMARY KEY,business_id UUID NOT NULL REFERENCES businesses(id),created_by UUID REFERENCES users(id),storage_key TEXT NOT NULL,checksum TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),expires_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS idx_backup_metadata_business_date ON backup_metadata(business_id,created_at DESC);
