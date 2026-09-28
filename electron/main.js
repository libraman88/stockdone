const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

let db = null;

function loadSqlite() {
  try {
    const Database = require("better-sqlite3");
    const dbDir = path.join(app.getPath("userData"), "data");
    fs.mkdirSync(dbDir, { recursive: true });
    db = new Database(path.join(dbDir, "stockdone.sqlite"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    return db;
  } catch (error) {
    console.warn("SQLite unavailable; app can continue in browser/API mode.", error.message);
    return null;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js")
    }
  });
  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, "../dist/index.html"));
}

app.whenReady().then(() => {
  loadSqlite();

  ipcMain.handle("offline-db:status", () => ({ available: Boolean(db) }));
  ipcMain.handle("offline-db:exec", (_event, sql, params = []) => {
    if (!db) throw new Error("Offline SQLite is unavailable.");
    const statement = db.prepare(sql);
    return statement.run(...params);
  });
  ipcMain.handle("offline-db:query", (_event, sql, params = []) => {
    if (!db) throw new Error("Offline SQLite is unavailable.");
    return db.prepare(sql).all(...params);
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
