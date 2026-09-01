import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { _electron as electron } from "playwright-core";

const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const fixture = path.join(appRoot, "tests", "fixtures", "quick-retrieval-app");

test("固定数据 QuickRetrieval 真实验证焦点、键盘闭环和 warm 性能", {
  skip: process.env.HERMIT_RUN_DESKTOP_QUALIFICATION !== "1"
    ? "设置 HERMIT_RUN_DESKTOP_QUALIFICATION=1 才运行真实 Electron 资格"
    : false,
  timeout: 90_000,
}, async () => {
  const application = await electron.launch({
    executablePath: electronPath,
    args: [fixture],
    cwd: appRoot,
    timeout: 30_000,
  });
  try {
    await waitForQualification(application);
    const registration = await report(application);
    assert.equal(registration.registered, true, JSON.stringify(registration));

    await trigger(application);
    const panel = await waitForPanel(application);
    const rendererState = await panel.evaluate(() => ({
      bridge: typeof window.hermitQuickRetrievalQualification,
      activeElement: document.activeElement?.tagName ?? null,
    }));
    assert.equal(rendererState.bridge, "object", JSON.stringify(rendererState));
    const anchored = await report(application);
    assertWithinWorkArea(anchored.panelBounds, anchored.anchor.workArea);
    assert.ok(
      new Set(["left", "right"]).has(anchored.anchor.sideX)
        && new Set(["above", "below"]).has(anchored.anchor.sideY),
      JSON.stringify(anchored.anchor),
    );
    const search = panel.getByRole("searchbox", { name: "搜索剪贴板历史" });
    await waitUntil(
      async () => await search.evaluate((element) => element === document.activeElement),
      (focused) => focused === true,
      "搜索框未获得焦点",
    );

    await search.fill("项目");
    const results = panel.getByRole("option");
    assert.equal(await results.count(), 1);
    assert.match(await results.first().innerText(), /项目风险/u);
    await search.press("Enter");
    await waitUntil(
      async () => (await report(application)).selections.length,
      (count) => count === 1,
      "Enter 没有产生选择结果",
    );
    let current = await report(application);
    assert.deepEqual(current.selections, ["clip-2"]);
    assert.equal(current.targetFocused, true);
    assert.equal(current.panelVisible, false);

    await trigger(application);
    await search.press("ArrowDown");
    assert.equal(await panel.getByRole("option", { selected: true }).getAttribute("data-id"), "clip-2");
    await search.press("Escape");
    await waitUntil(
      async () => (await report(application)).cancelled,
      (count) => count === 1,
      "Esc 没有关闭浮层",
    );

    for (let index = 0; index < 100; index += 1) {
      await trigger(application);
      await waitForLatencyCount(application, index + 3);
      await search.press("Escape");
      await waitForCancelCount(application, index + 2);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    current = await report(application);
    const warm = [...current.latencies].slice(2).sort((left, right) => left - right);
    const p50 = percentile(warm, 0.50);
    const p95 = percentile(warm, 0.95);
    const p99 = percentile(warm, 0.99);
    console.log(JSON.stringify({ samples: warm.length, p50, p95, p99, max: warm.at(-1) }));
    assert.ok(p95 <= 300, `warm p95 ${String(p95)}ms > 300ms`);
    assert.ok(p99 <= 500, `warm p99 ${String(p99)}ms > 500ms`);

    await trigger(application);
    await application.evaluate(() => globalThis.__hermitQuickRetrievalQualification.simulateLock());
    current = await report(application);
    assert.equal(current.lockHides, 1);
    assert.equal(current.panelVisible, false);
    await waitUntil(
      async () => (await report(application)).targetFocused,
      (focused) => focused === true,
      "锁屏关闭浮层后原窗口焦点未恢复",
    );

    const artifactDirectory = path.resolve(appRoot, "..", "..", ".hermit", "artifacts");
    fs.mkdirSync(artifactDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(
        artifactDirectory,
        `smart-clipboard-quick-retrieval-${process.platform}-${process.arch}.json`,
      ),
      `${JSON.stringify({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        status: "PASS",
        subject: "qualification-electron-process",
        interaction: {
          surface: "cursor-anchored-context-menu",
          shortcutRegistered: registration.registered,
          searchFocus: true,
          inputFiltering: true,
          keyboardSelection: true,
          escapeClose: true,
          targetFocusRestored: true,
          lockHide: true,
          workAreaContainment: true,
        },
        performance: { samples: warm.length, p50, p95, p99, max: warm.at(-1) },
      }, null, 2)}\n`,
      "utf8",
    );
  } finally {
    await application.close();
  }
});

async function waitForQualification(application) {
  await waitUntil(
    async () => await application.evaluate(() =>
      typeof globalThis.__hermitQuickRetrievalQualification === "object"),
    (ready) => ready === true,
    "QuickRetrieval qualification fixture 未就绪",
    10_000,
  );
}

async function trigger(application) {
  await application.evaluate(() => globalThis.__hermitQuickRetrievalQualification.triggerShortcut());
}

async function report(application) {
  return await application.evaluate(() => globalThis.__hermitQuickRetrievalQualification.report());
}

async function waitForPanel(application) {
  return await waitUntil(
    () => application.windows().find((page) =>
      page.url().startsWith("data:text/html") && page.url().includes("Quick%20Retrieval")),
    (page) => page !== undefined,
    "QuickRetrieval renderer 未出现",
    10_000,
  );
}

async function waitForLatencyCount(application, expected) {
  await waitUntil(
    async () => (await report(application)).latencies.length,
    (count) => count === expected,
    `第 ${String(expected)} 次浮层交互状态未就绪`,
  );
}

async function waitForCancelCount(application, expected) {
  await waitUntil(
    async () => (await report(application)).cancelled,
    (count) => count === expected,
    `第 ${String(expected)} 次浮层关闭未完成`,
  );
}

function percentile(values, quantile) {
  return values[Math.ceil(values.length * quantile) - 1];
}

function assertWithinWorkArea(bounds, workArea) {
  assert.ok(bounds.x >= workArea.x, JSON.stringify({ bounds, workArea }));
  assert.ok(bounds.y >= workArea.y, JSON.stringify({ bounds, workArea }));
  assert.ok(
    bounds.x + bounds.width <= workArea.x + workArea.width,
    JSON.stringify({ bounds, workArea }),
  );
  assert.ok(
    bounds.y + bounds.height <= workArea.y + workArea.height,
    JSON.stringify({ bounds, workArea }),
  );
}

async function waitUntil(read, accepts, message, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (accepts(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}
