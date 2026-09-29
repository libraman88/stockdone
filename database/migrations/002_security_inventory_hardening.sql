-- StockDone security and inventory hardening migration
-- Run after database/schema.sql

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  sale_id UUID NOT NULL REFERENCES sales(id),
  method TEXT NOT NULL CHECK(method IN ('cash','card','bank','other')),
  amount NUMERIC(12,2) NOT NULL CHECK(amount >= 0),
  received NUMERIC(12,2),
  change_amount NUMERIC(12,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments(sale_id,created_at DESC);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(business_id,name)
);

CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY(role_id,permission_id)
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  variant_id UUID NOT NULL REFERENCES product_variants(id),
  quantity_delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(reason IN ('Damaged','Missing','Physical Count','Correction','Other')),
  note TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id),
  from_branch_id UUID NOT NULL REFERENCES branches(id),
  to_branch_id UUID NOT NULL REFERENCES branches(id),
  status TEXT NOT NULL CHECK(status IN ('draft','sent','received','cancelled')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id UUID PRIMARY KEY,
  transfer_id UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES product_variants(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0)
);

ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS cashier_id UUID REFERENCES users(id);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sales_business_date ON sales(business_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_business_date ON purchases(business_id,purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_product_variants_barcode ON product_variants(barcode);
CREATE INDEX IF NOT EXISTS idx_inventory_branch_qty ON inventory(branch_id,quantity);

INSERT INTO permissions(id,code,description) VALUES
(gen_random_uuid(),'sales','Create and manage sales'),
(gen_random_uuid(),'products','Manage products'),
(gen_random_uuid(),'inventory','Manage inventory'),
(gen_random_uuid(),'purchases','Manage purchases'),
(gen_random_uuid(),'customers','Manage customers and khata'),
(gen_random_uuid(),'returns','Process returns and exchanges'),
(gen_random_uuid(),'reports','View reports'),
(gen_random_uuid(),'users','Manage users and roles'),
(gen_random_uuid(),'settings','Manage system settings'),
(gen_random_uuid(),'admin','Administrative actions')
ON CONFLICT(code) DO NOTHING;


-- Return/exchange hardening
ALTER TABLE returns ADD COLUMN IF NOT EXISTS price_difference NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS direction TEXT NOT NULL DEFAULT 'in' CHECK(direction IN ('in','out'));
CREATE INDEX IF NOT EXISTS idx_return_items_return_direction ON return_items(return_id,direction);


-- Seed DB-backed default roles and role permissions
INSERT INTO roles(id,business_id,name)
VALUES
(gen_random_uuid(),(SELECT id FROM businesses LIMIT 1),'owner'),
(gen_random_uuid(),(SELECT id FROM businesses LIMIT 1),'manager'),
(gen_random_uuid(),(SELECT id FROM businesses LIMIT 1),'cashier')
ON CONFLICT (business_id,name) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name='owner'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r JOIN permissions p ON p.code IN ('sales','products','inventory','purchases','customers','returns','reports')
WHERE r.name='manager'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r JOIN permissions p ON p.code IN ('sales','customers','print')
WHERE r.name='cashier'
ON CONFLICT DO NOTHING;


-- Allow custom role names and per-role permission management.
ALTER TABLE roles DROP CONSTRAINT IF EXISTS roles_name_check;


-- Authentication session and password reset state
CREATE TABLE IF NOT EXISTS auth_sessions (id UUID PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),revoked_at TIMESTAMPTZ);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id,expires_at);
CREATE TABLE IF NOT EXISTS password_reset_tokens (id UUID PRIMARY KEY,user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id,expires_at);


-- Snapshot return/exchange cost for historical profit reporting
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Return/refund payment ledger
CREATE TABLE IF NOT EXISTS refund_payments (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id),
  branch_id UUID NOT NULL REFERENCES branches(id),
  return_id UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK(method IN ('cash','card','bank','other')),
  amount NUMERIC(12,2) NOT NULL CHECK(amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refund_payments_return ON refund_payments(return_id,created_at DESC);


-- Supplier payable ledger
CREATE TABLE IF NOT EXISTS supplier_transactions (
  id UUID PRIMARY KEY,
  business_id UUID NOT NULL REFERENCES businesses(id),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('purchase','payment')),
  amount NUMERIC(12,2) NOT NULL CHECK(amount >= 0),
  reference_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_supplier_transactions_supplier ON supplier_transactions(supplier_id,created_at DESC);
