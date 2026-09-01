import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const tempParent = path.join(root, ".hermit", "tmp");
mkdirSync(tempParent, { recursive: true });
const workspace = mkdtempSync(path.join(tempParent, "qualification-install-"));
const corepack = "corepack";

for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
  copyFileSync(path.join(root, file), path.join(workspace, file));
}

let failure;
try {
  for (const args of [
    ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts", "--strict-peer-dependencies"],
  ]) {
    const windows = process.platform === "win32";
    const command = windows ? `${corepack} ${args.join(" ")}` : corepack;
    const child = spawnSync(command, windows ? [] : args, {
      cwd: workspace,
      env: { ...process.env, CI: "true" },
      shell: windows,
      stdio: "inherit",
    });
    if (child.error !== undefined) {
      failure = { code: 1, message: child.error.message };
      break;
    }
    if (child.status !== 0) {
      failure = { code: child.status ?? 1, message: `${corepack} ${args.join(" ")} 失败` };
      break;
    }
  }
} finally {
  rmSync(workspace, { force: true, recursive: true });
}

if (failure === undefined) {
  process.stdout.write("Clean qualification install passed.\n");
} else {
  process.stderr.write(`${failure.message}\n`);
  process.exitCode = failure.code;
}
