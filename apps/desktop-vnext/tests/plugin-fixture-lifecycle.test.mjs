import assert from "node:assert/strict";
import test from "node:test";

import { Context } from "@deepseek-ai/cordis";
import { WebServer } from "@deepseek-ai/dsh-host-webserver";
import hermitTestPlugin from "./fixtures/hermit-test-plugin/index.js";

test("资格插件随 Cordis fiber 在同一进程内释放 HTTP 路由", async () => {
  const root = new Context();
  try {
    await root.plugin(WebServer, { host: "127.0.0.1", port: 0 });
    const pluginFiber = await root.plugin(hermitTestPlugin);
    const route = `http://127.0.0.1:${String(root.webServer.port)}/__hermit_test_plugin__`;

    const active = await fetch(route);
    assert.equal(active.status, 200);
    assert.equal(await active.text(), "hermit-test-plugin-active");

    await pluginFiber.dispose();
    const disposed = await fetch(route);
    assert.equal(disposed.status, 404);
  } finally {
    await root.fiber.dispose();
  }
});
