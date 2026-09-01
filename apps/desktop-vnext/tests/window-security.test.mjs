import assert from "node:assert/strict";
import test from "node:test";
import { hardenedWebPreferences } from "../lib/desktop/window-options.js";

test("DSH renderer 不获得 Node、preload 或 webview 权限", () => {
  const preferences = hardenedWebPreferences();
  assert.deepEqual(preferences, {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
  });
});
