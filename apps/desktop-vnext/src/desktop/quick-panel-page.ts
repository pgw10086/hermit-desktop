/** 生成 Quick Panel 本地页面，页面只通过 preload bridge 交接输入。 */
export function quickPanelPageUrl(): string {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <title>Hermit Quick Panel</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: Canvas;
      color: CanvasText;
    }
    body { margin: 0; min-height: 100vh; }
    main { box-sizing: border-box; min-height: 100vh; padding: 24px; display: grid; align-content: start; gap: 18px; }
    header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
    h1 { margin: 0; font-size: 20px; letter-spacing: 0; }
    kbd { border: 1px solid ButtonBorder; border-radius: 4px; padding: 2px 6px; color: GrayText; font-size: 12px; }
    nav { display: flex; gap: 6px; border-bottom: 1px solid ButtonBorder; }
    nav button { border: 0; border-bottom: 2px solid transparent; border-radius: 0; padding: 8px 10px; color: ButtonText; background: transparent; cursor: pointer; }
    nav button[aria-selected="true"] { border-bottom-color: Highlight; color: CanvasText; }
    section { display: grid; gap: 12px; }
    label { font-size: 13px; color: GrayText; }
    textarea, input { width: 100%; box-sizing: border-box; border: 1px solid ButtonBorder; border-radius: 6px; padding: 10px; color: CanvasText; background: Canvas; font: inherit; }
    textarea { min-height: 180px; resize: vertical; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    button.action { border: 1px solid ButtonBorder; border-radius: 6px; padding: 9px 12px; color: ButtonText; background: ButtonFace; cursor: pointer; }
    button.action.primary { color: HighlightText; border-color: Highlight; background: Highlight; }
    button:focus-visible, textarea:focus-visible, input:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
    [hidden] { display: none !important; }
    #status { min-height: 1.5em; color: GrayText; font-size: 13px; overflow-wrap: anywhere; }
    .notice { margin: 0; color: GrayText; font-size: 13px; line-height: 1.5; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Quick Panel</h1>
      <kbd>Esc 关闭</kbd>
    </header>
    <nav aria-label="Quick Panel 模式">
      <button type="button" data-mode="draft" aria-selected="true">草稿</button>
      <button type="button" data-mode="search" aria-selected="false">搜索</button>
    </nav>
    <section data-panel="draft">
      <label for="draft">准备交给主窗口的文字</label>
      <textarea id="draft" placeholder="输入后打开主窗口，检查并自行发送"></textarea>
      <p class="notice">Quick Panel 不调用模型，也不会直接写入 DSH Session。当前版本会打开主窗口，交接是否可用以实际状态为准。</p>
      <div class="actions"><button class="action primary" type="button" id="draft-action">打开主窗口</button></div>
    </section>
    <section data-panel="search" hidden>
      <label for="query">搜索关键词</label>
      <input id="query" type="search" autocomplete="off" placeholder="在主窗口中继续搜索">
      <p class="notice">当前没有公开的跨数据源搜索接口，Quick Panel 不会伪造搜索结果。</p>
      <div class="actions"><button class="action primary" type="button" id="search-action">打开主窗口搜索</button></div>
    </section>
    <p id="status" role="status" aria-live="polite"></p>
  </main>
  <script>
    (() => {
      const bridge = window.hermitQuickPanel;
      const status = document.querySelector("#status");
      const draft = document.querySelector("#draft");
      const query = document.querySelector("#query");
      const setStatus = (message) => { status.textContent = message; };
      const request = async (action) => {
        try {
          const result = await action();
          setStatus(result.status === "opened" ? "已打开主窗口，请继续检查。" : result.reason);
        } catch (error) {
          setStatus(error instanceof Error ? error.message : "操作失败，请到主窗口继续。");
        }
      };
      for (const tab of document.querySelectorAll("[data-mode]")) {
        tab.addEventListener("click", () => {
          const mode = tab.dataset.mode;
          for (const candidate of document.querySelectorAll("[data-mode]")) candidate.setAttribute("aria-selected", candidate === tab ? "true" : "false");
          for (const panel of document.querySelectorAll("[data-panel]")) panel.hidden = panel.dataset.panel !== mode;
          setStatus("");
        });
      }
      document.querySelector("#draft-action").addEventListener("click", () => {
        const text = draft.value.trim();
        if (text.length === 0) { setStatus("请先输入草稿。"); draft.focus(); return; }
        void request(() => bridge.submitDraft(text));
      });
      document.querySelector("#search-action").addEventListener("click", () => {
        const text = query.value.trim();
        if (text.length === 0) { setStatus("请先输入搜索关键词。"); query.focus(); return; }
        void request(() => bridge.search(text));
      });
      document.addEventListener("keydown", (event) => { if (event.key === "Escape") window.close(); });
      draft.focus();
    })();
  </script>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
