const MARKER = "hermit-test-plugin-active";

const hermitTestPlugin = (ctx) => {
  ctx.effect(() => ctx.webServer.register({
    kind: "exact",
    path: "/__hermit_test_plugin__",
    handler: (_request, response) => {
      response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      response.end(MARKER);
    },
  }), "hermit-test-plugin: qualification route");
};
hermitTestPlugin.inject = ["webServer"];

export default hermitTestPlugin;
