const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stockDoneOffline", {
  status: () => ipcRenderer.invoke("offline-db:status"),
  exec: (sql, params = []) => ipcRenderer.invoke("offline-db:exec", sql, params),
  query: (sql, params = []) => ipcRenderer.invoke("offline-db:query", sql, params)
});
