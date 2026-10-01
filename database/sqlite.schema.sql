-- StockDone offline SQLite schema
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  category TEXT,
  size TEXT,
  color TEXT,
  barcode TEXT UNIQUE,
  cost REAL NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  qty INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 5,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  invoice_no TEXT NOT NULL UNIQUE,
  client_reference TEXT UNIQUE,
  total REAL NOT NULL,
  payment_method TEXT NOT NULL,
  discount REAL NOT NULL DEFAULT 0,
  customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL,
  price REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  type TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  reason TEXT,
  reference_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  local_payload TEXT NOT NULL,
  server_payload TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  resolution TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_sqlite_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_sqlite_products_updated ON products(updated_at);
CREATE INDEX IF NOT EXISTS idx_sqlite_stock_product_date ON stock_movements(product_id,created_at);
CREATE INDEX IF NOT EXISTS idx_sqlite_sync_status ON sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_sqlite_sync_entity ON sync_queue(entity,entity_id);
CREATE INDEX IF NOT EXISTS idx_sqlite_conflict_status ON sync_conflicts(resolution);

CREATE TABLE IF NOT EXISTS brands (id TEXT PRIMARY KEY,business_id TEXT NOT NULL,name TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sub_categories (id TEXT PRIMARY KEY,business_id TEXT NOT NULL,category_id TEXT,name TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS floors (id TEXT PRIMARY KEY,business_id TEXT NOT NULL,name TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS warehouses (id TEXT PRIMARY KEY,business_id TEXT NOT NULL,name TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS raw_materials (id TEXT PRIMARY KEY,business_id TEXT NOT NULL,name TEXT NOT NULL,supplier_id TEXT,unit TEXT NOT NULL DEFAULT 'meter',quantity REAL NOT NULL DEFAULT 0,cost REAL NOT NULL DEFAULT 0,location TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fabric_lots (id TEXT PRIMARY KEY,business_id TEXT NOT NULL,raw_material_id TEXT NOT NULL,lot_number TEXT NOT NULL,meter_quantity REAL NOT NULL DEFAULT 0,cost REAL NOT NULL DEFAULT 0,location TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cmt_jobs (id TEXT PRIMARY KEY,business_id TEXT NOT NULL,supplier_id TEXT,fabric_lot_id TEXT,meters_sent REAL NOT NULL DEFAULT 0,pieces_received INTEGER NOT NULL DEFAULT 0,job_date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',notes TEXT);
