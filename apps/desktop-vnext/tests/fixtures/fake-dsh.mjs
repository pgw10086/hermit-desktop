import fs from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";

const mode = process.argv[2] ?? "healthy";
const stateFile = process.argv[3];

if (mode === "invalid-url") {
  process.stdout.write("dsh web: http://0.0.0.0:31337\n");
  setInterval(() => undefined, 1_000);
} else {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Fake DSH</title>");
  });
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address === null || typeof address === "string") process.exit(2);

    if (mode === "process-tree" || mode === "process-tree-stubborn") {
      if (stateFile === undefined) process.exit(3);
      const descendant = spawn(
        process.execPath,
        [
          "-e",
          mode === "process-tree-stubborn"
            ? "process.on('SIGTERM', () => {}); setInterval(() => undefined, 1000)"
            : "setInterval(() => undefined, 1000)",
        ],
        { stdio: "ignore" },
      );
      if (descendant.pid === undefined) process.exit(4);
      fs.writeFileSync(
        stateFile,
        mode === "process-tree-stubborn"
          ? JSON.stringify({ rootPid: process.pid, descendantPid: descendant.pid })
          : String(descendant.pid),
      );
    }

    process.stdout.write(`dsh web: http://127.0.0.1:${String(address.port)}\n`);

    if (mode === "crash-first" || mode === "crash-always") {
      if (stateFile === undefined) process.exit(3);
      const launches = fs.existsSync(stateFile)
        ? Number(fs.readFileSync(stateFile, "utf8"))
        : 0;
      fs.writeFileSync(stateFile, String(launches + 1));
      if (mode === "crash-always" || launches === 0) setTimeout(() => process.exit(23), 150);
    }
  });

  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
