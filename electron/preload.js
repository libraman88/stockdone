const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stockDoneUpdates", {
  version: () => ipcRenderer.invoke("app:version"),
  check: () => ipcRenderer.invoke("app:check-for-updates"),
  install: () => ipcRenderer.invoke("app:install-update"),
  onAvailable: (callback) => ipcRenderer.on("app:update-available", callback),
  onProgress: (callback) => ipcRenderer.on("app:update-progress", (_event, percent) => callback(percent)),
  onReady: (callback) => ipcRenderer.on("app:update-ready", callback)
});

contextBridge.exposeInMainWorld("stockDoneHardware", {
  printers: () => ipcRenderer.invoke("hardware:printers"),
  print: (html, paper = "A4", deviceName = "") => ipcRenderer.invoke("hardware:print", html, paper, deviceName)
});

contextBridge.exposeInMainWorld("stockDoneOffline", {
  status: () => ipcRenderer.invoke("offline-db:status"),
  exec: (sql, params = []) => ipcRenderer.invoke("offline-db:exec", sql, params),
  query: (sql, params = []) => ipcRenderer.invoke("offline-db:query", sql, params)
});
