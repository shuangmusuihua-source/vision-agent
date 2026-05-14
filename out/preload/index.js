"use strict";
const electron = require("electron");
const api = {
  ping: () => electron.ipcRenderer.invoke("ping"),
  workspace: {
    listFiles: (dirPath) => electron.ipcRenderer.invoke("workspace:listFiles", dirPath),
    readFile: (filePath) => electron.ipcRenderer.invoke("workspace:readFile", filePath),
    writeFile: (filePath, content) => electron.ipcRenderer.invoke("workspace:writeFile", filePath, content),
    openDirectoryDialog: () => electron.ipcRenderer.invoke("workspace:openDirectoryDialog")
  },
  settings: {
    get: () => electron.ipcRenderer.invoke("settings:get"),
    addProfile: (profile) => electron.ipcRenderer.invoke("settings:addProfile", profile),
    updateProfile: (id, updates) => electron.ipcRenderer.invoke("settings:updateProfile", id, updates),
    removeProfile: (id) => electron.ipcRenderer.invoke("settings:removeProfile", id),
    setActiveProfile: (id) => electron.ipcRenderer.invoke("settings:setActiveProfile", id),
    addDirectory: (dir) => electron.ipcRenderer.invoke("settings:addDirectory", dir),
    removeDirectory: (dir) => electron.ipcRenderer.invoke("settings:removeDirectory", dir)
  },
  agent: {
    sendMessage: (prompt, sessionId) => electron.ipcRenderer.invoke("agent:sendMessage", prompt, sessionId),
    getSessionList: () => electron.ipcRenderer.invoke("agent:getSessionList"),
    onMessage: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on("agent:message", handler);
      return () => electron.ipcRenderer.removeListener("agent:message", handler);
    },
    onSessionCreated: (callback) => {
      const handler = (_event, sessionId) => callback(sessionId);
      electron.ipcRenderer.on("agent:sessionCreated", handler);
      return () => electron.ipcRenderer.removeListener("agent:sessionCreated", handler);
    },
    onComplete: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on("agent:complete", handler);
      return () => electron.ipcRenderer.removeListener("agent:complete", handler);
    },
    onError: (callback) => {
      const handler = (_event, data) => callback(data);
      electron.ipcRenderer.on("agent:error", handler);
      return () => electron.ipcRenderer.removeListener("agent:error", handler);
    }
  }
};
electron.contextBridge.exposeInMainWorld("api", api);
