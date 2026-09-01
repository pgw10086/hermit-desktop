import type { QuickRetrievalFixtureItem } from "./quick-retrieval-contract.js";

/** 生成资格测试用 Quick Retrieval 页面，并限制 fixture 只能通过 bridge 回传事件。 */
export function quickRetrievalFixturePageUrl(
  items: readonly QuickRetrievalFixtureItem[],
): string {
  const fixture = JSON.stringify(items).replaceAll("<", "\\u003c");
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <title>Quick Retrieval Qualification</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; background: Canvas; color: CanvasText; }
    body { margin: 0; }
    main { box-sizing: border-box; min-height: 100vh; padding: 16px; display: grid; gap: 10px; align-content: start; }
    input { box-sizing: border-box; width: 100%; height: 40px; border: 1px solid ButtonBorder; border-radius: 6px; padding: 0 10px; background: Canvas; color: CanvasText; font: inherit; }
    [role="listbox"] { display: grid; min-height: 180px; border-top: 1px solid ButtonBorder; }
    [role="option"] { box-sizing: border-box; min-height: 52px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 8px 10px; border-bottom: 1px solid ButtonBorder; }
    [role="option"][aria-selected="true"] { color: HighlightText; background: Highlight; }
    .text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .source { color: GrayText; font-size: 12px; }
    [aria-selected="true"] .source { color: inherit; }
    #empty { min-height: 52px; display: grid; align-items: center; color: GrayText; }
  </style>
</head>
<body>
  <main>
    <input id="search" type="search" autocomplete="off" aria-label="搜索剪贴板历史" placeholder="搜索剪贴板历史">
    <div id="results" role="listbox" aria-label="剪贴板搜索结果"></div>
    <div id="empty" hidden>没有匹配记录</div>
  </main>
  <script>
    (() => {
      const items = ${fixture};
      const bridge = window.hermitQuickRetrievalQualification;
      const search = document.querySelector("#search");
      const results = document.querySelector("#results");
      const empty = document.querySelector("#empty");
      let visible = [...items];
      let selected = 0;

      const render = () => {
        results.replaceChildren();
        empty.hidden = visible.length > 0;
        selected = Math.max(0, Math.min(selected, visible.length - 1));
        visible.forEach((item, index) => {
          const row = document.createElement("div");
          row.setAttribute("role", "option");
          row.setAttribute("aria-selected", String(index === selected));
          row.dataset.id = item.id;
          const text = document.createElement("span");
          text.className = "text";
          text.textContent = item.text;
          const source = document.createElement("span");
          source.className = "source";
          source.textContent = item.source;
          row.append(text, source);
          row.addEventListener("mousedown", (event) => event.preventDefault());
          row.addEventListener("click", () => bridge.select(item.id));
          results.append(row);
        });
      };

      const searchItems = () => {
        const query = search.value.trim().toLocaleLowerCase();
        visible = query.length === 0
          ? [...items]
          : items.filter((item) => item.text.toLocaleLowerCase().includes(query));
        selected = 0;
        render();
      };

      search.addEventListener("input", searchItems);
      search.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" && visible.length > 0) {
          event.preventDefault();
          selected = (selected + 1) % visible.length;
          render();
        } else if (event.key === "ArrowUp" && visible.length > 0) {
          event.preventDefault();
          selected = (selected - 1 + visible.length) % visible.length;
          render();
        } else if (event.key === "Enter" && visible[selected] !== undefined) {
          event.preventDefault();
          bridge.select(visible[selected].id);
        } else if (event.key === "Escape") {
          event.preventDefault();
          bridge.cancel();
        }
      });

      bridge.onShow(() => {
        search.value = "";
        visible = [...items];
        selected = 0;
        render();
        search.focus();
        requestAnimationFrame(() => requestAnimationFrame(() => bridge.interactive()));
      });
      render();
    })();
  </script>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
