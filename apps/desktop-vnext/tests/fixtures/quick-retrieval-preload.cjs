const { contextBridge, ipcRenderer } = require("electron");

const INTERACTIVE = "hermit:qualification:quick-retrieval-interactive";
const SELECT = "hermit:qualification:quick-retrieval-select";
const CANCEL = "hermit:qualification:quick-retrieval-cancel";
const SHOW = "hermit:qualification:quick-retrieval-show";

contextBridge.exposeInMainWorld("hermitQuickRetrievalQualification", {
  interactive: () => ipcRenderer.send(INTERACTIVE),
  select: (id) => ipcRenderer.send(SELECT, id),
  cancel: () => ipcRenderer.send(CANCEL),
  onShow: (listener) => ipcRenderer.on(SHOW, () => listener()),
});
