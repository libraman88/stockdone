const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stockDoneHardware", {
  printers: () => ipcRenderer.invoke("hardware:printers"),
  print: (html, paper = "A4", deviceName = "") => ipcRenderer.invoke("hardware:print", html, paper, deviceName)
});

contextBridge.exposeInMainWorld("stockDoneOffline", {
  status: () => ipcRenderer.invoke("offline-db:status"),
  exec: (sql, params = []) => ipcRenderer.invoke("offline-db:exec", sql, params),
  query: (sql, params = []) => ipcRenderer.invoke("offline-db:query", sql, params)
});
