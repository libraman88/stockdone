const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

let db = null;
let mainWindow = null;

const OFFLINE_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, sku TEXT NOT NULL UNIQUE, category TEXT, brand TEXT, sub_category TEXT, floor TEXT, warehouse TEXT, size TEXT, color TEXT, barcode TEXT UNIQUE, cost REAL NOT NULL DEFAULT 0, price REAL NOT NULL DEFAULT 0, qty INTEGER NOT NULL DEFAULT 0, reorder_level INTEGER NOT NULL DEFAULT 5, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sales (id TEXT PRIMARY KEY, invoice_no TEXT NOT NULL UNIQUE, client_reference TEXT UNIQUE, total REAL NOT NULL, payment_method TEXT NOT NULL, discount REAL NOT NULL DEFAULT 0, customer_id TEXT, status TEXT NOT NULL DEFAULT 'completed', created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sale_items (id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id), product_id TEXT NOT NULL REFERENCES products(id), qty INTEGER NOT NULL, price REAL NOT NULL, unit_cost REAL NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS stock_movements (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), type TEXT NOT NULL, quantity INTEGER NOT NULL, reason TEXT, reference_id TEXT, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sync_queue (id TEXT PRIMARY KEY, entity TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, synced_at TEXT)",
  "CREATE TABLE IF NOT EXISTS purchases (id TEXT PRIMARY KEY, invoice_no TEXT NOT NULL UNIQUE, supplier_id TEXT, total REAL NOT NULL, payment_method TEXT NOT NULL, paid_amount REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS purchase_items (id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL REFERENCES purchases(id), product_id TEXT NOT NULL REFERENCES products(id), qty INTEGER NOT NULL, cost REAL NOT NULL)",
  "CREATE TABLE IF NOT EXISTS supplier_transactions (id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL, type TEXT NOT NULL, amount REAL NOT NULL, reference_id TEXT, note TEXT, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sync_conflicts (id TEXT PRIMARY KEY, entity TEXT NOT NULL, entity_id TEXT NOT NULL, local_payload TEXT NOT NULL, server_payload TEXT NOT NULL, detected_at TEXT NOT NULL, resolution TEXT NOT NULL DEFAULT 'pending')",
  "CREATE INDEX IF NOT EXISTS idx_sqlite_products_barcode ON products(barcode)",
  "CREATE INDEX IF NOT EXISTS idx_sqlite_products_updated ON products(updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_sqlite_stock_product_date ON stock_movements(product_id,created_at)",
  "CREATE INDEX IF NOT EXISTS idx_sqlite_sync_status ON sync_queue(status)",
  "CREATE INDEX IF NOT EXISTS idx_sqlite_sync_entity ON sync_queue(entity,entity_id)"
];

function loadSqlite() {
  try {
    const Database = require("better-sqlite3");
    const dbDir = path.join(app.getPath("userData"), "data");
    fs.mkdirSync(dbDir, { recursive: true });
    db = new Database(path.join(dbDir, "stockdone.sqlite"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.transaction(() => { OFFLINE_SCHEMA.forEach((sql) => db.prepare(sql).run()); const cols = db.prepare("PRAGMA table_info(products)").all(); const names = new Set(cols.map(c => c.name)); for (const [name,type] of [["brand","TEXT"],["sub_category","TEXT"],["floor","TEXT"],["warehouse","TEXT"]]) { if (!names.has(name)) db.prepare(`ALTER TABLE products ADD COLUMN ${name} ${type}`).run(); } })();
    return db;
  } catch (error) {
    console.warn("SQLite unavailable; app can continue in browser/API mode.", error.message);
    return null;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, "preload.js") }
  });
  mainWindow = win;
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, "../dist/index.html"));
}

app.whenReady().then(() => {
  loadSqlite();
  ipcMain.handle("offline-db:status", () => ({ available: Boolean(db) }));
  ipcMain.handle("offline-db:exec", (_event, sql, params = []) => {
    if (!db) throw new Error("Offline SQLite is unavailable.");
    return db.prepare(sql).run(...params);
  });
  ipcMain.handle("hardware:printers", async () => {
    if (!mainWindow) return [];
    return mainWindow.webContents.getPrintersAsync();
  });
  ipcMain.handle("hardware:print", async (_event, html, paper = "A4", deviceName = "") => {
    const printWindow = new BrowserWindow({show:false, webPreferences:{contextIsolation:true,nodeIntegration:false}});
    try {
      await printWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(String(html)));
      await new Promise(resolve => setTimeout(resolve, 250));
      const pageSize = paper === "80mm" ? {width:80000,height:2000000} : "A4";
      return await new Promise((resolve, reject) => {
        printWindow.webContents.print({silent:Boolean(deviceName),deviceName:deviceName||undefined,pageSize,printBackground:true}, (success,failureReason) => {
          printWindow.close();
          if(success) resolve({ok:true}); else reject(new Error(failureReason || "Printer failed"));
        });
      });
    } catch (error) {
      if (!printWindow.isDestroyed()) printWindow.close();
      throw error;
    }
  });
  ipcMain.handle("offline-db:query", (_event, sql, params = []) => {
    if (!db) throw new Error("Offline SQLite is unavailable.");
    return db.prepare(sql).all(...params);
  });
  createWindow();
  setupAutoUpdater();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

function setupAutoUpdater() {
  if (!app.isPackaged) return;
  const { autoUpdater } = require("electron-updater");
  const dbPath = path.join(app.getPath("userData"), "data", "stockdone.sqlite");
  const backupDir = path.join(app.getPath("userData"), "backups");
  const backupDatabase = () => {
    try {
      if (!fs.existsSync(dbPath)) return;
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.copyFileSync(dbPath, path.join(backupDir, `stockdone-${stamp}.sqlite`));
    } catch (error) { console.warn("Update backup failed:", error.message); }
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", () => mainWindow?.webContents.send("app:update-available"));
  autoUpdater.on("download-progress", (p) => mainWindow?.webContents.send("app:update-progress", p.percent));
  autoUpdater.on("update-downloaded", () => mainWindow?.webContents.send("app:update-ready"));
  autoUpdater.on("error", (e) => console.warn("Auto update error:", e.message));
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("app:check-for-updates", async () => {
    try { const r = await autoUpdater.checkForUpdates(); return { ok:true, version:r?.updateInfo?.version || null }; }
    catch (e) { return { ok:false, error:e.message }; }
  });
  ipcMain.handle("app:install-update", () => { backupDatabase(); autoUpdater.quitAndInstall(false, true); return {ok:true}; });
  autoUpdater.checkForUpdatesAndNotify().catch((e) => console.warn("Initial update check failed:", e.message));
}

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
