-- StockDone offline SQLite core schema
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY,name TEXT NOT NULL,sku TEXT NOT NULL UNIQUE,category TEXT,size TEXT,color TEXT,barcode TEXT UNIQUE,cost REAL NOT NULL DEFAULT 0,price REAL NOT NULL DEFAULT 0,qty INTEGER NOT NULL DEFAULT 0,reorder_level INTEGER NOT NULL DEFAULT 5);
CREATE TABLE IF NOT EXISTS sales (id TEXT PRIMARY KEY,invoice_no TEXT NOT NULL UNIQUE,total REAL NOT NULL,payment_method TEXT NOT NULL,discount REAL NOT NULL DEFAULT 0,customer_id TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sale_items (id TEXT PRIMARY KEY,sale_id TEXT NOT NULL REFERENCES sales(id),product_id TEXT NOT NULL REFERENCES products(id),qty INTEGER NOT NULL,price REAL NOT NULL);
CREATE TABLE IF NOT EXISTS stock_movements (id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),type TEXT NOT NULL,quantity INTEGER NOT NULL,reason TEXT,reference_id TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_queue (id TEXT PRIMARY KEY,entity TEXT NOT NULL,entity_id TEXT NOT NULL,operation TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_sqlite_stock_product_date ON stock_movements(product_id,created_at);
CREATE INDEX IF NOT EXISTS idx_sqlite_sync_status ON sync_queue(status);
