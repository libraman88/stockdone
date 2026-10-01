-- Extensible master data support
CREATE TABLE IF NOT EXISTS master_data_types (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  label TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id,name)
);
CREATE TABLE IF NOT EXISTS master_data_items (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  type_id UUID NOT NULL REFERENCES master_data_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id,type_id,name)
);
CREATE INDEX IF NOT EXISTS idx_master_data_items_type ON master_data_items(type_id,active,name);
