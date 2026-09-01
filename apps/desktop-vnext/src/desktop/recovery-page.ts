/** 转义恢复页中的运行时错误文本，避免错误信息注入 HTML。 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** 生成无外部依赖的 DSH 恢复页面。 */
export function recoveryPageUrl(message: string): string {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hermit 恢复</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
    main { width: min(520px, calc(100vw - 48px)); }
    h1 { margin: 0 0 12px; font-size: 24px; letter-spacing: 0; }
    p { margin: 0 0 24px; line-height: 1.6; color: GrayText; overflow-wrap: anywhere; }
    nav { display: flex; gap: 12px; flex-wrap: wrap; }
    a { border: 1px solid ButtonBorder; border-radius: 6px; padding: 9px 14px; color: ButtonText; background: ButtonFace; text-decoration: none; }
    a:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
  </style>
</head>
<body>
  <main>
    <h1>DSH 没有正常启动</h1>
    <p>${escapeHtml(message)}</p>
    <nav aria-label="恢复操作">
      <a href="hermit://runtime/restart">重新启动 DSH</a>
      <a href="hermit://app/quit">退出 Hermit</a>
    </nav>
  </main>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
