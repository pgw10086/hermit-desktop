import assert from "node:assert/strict";
import test from "node:test";
import {
  descendantRows,
  findRuntimeResidue,
  identifyHermitRuntime,
  parsePosixProcessSnapshot,
  parseWindowsProcessSnapshot,
  sameProcessExists,
} from "./helpers/process-snapshot.mjs";

test("Hermit runtime 通过 carrier -> DSH 父子关系识别，不把 carrier 参数误认成 DSH", () => {
  const rows = parsePosixProcessSnapshot(`
100 1 100 /Applications/Hermit.app/Contents/MacOS/Hermit
110 100 110 /runtime/node/bin/node /runtime/carrier/dsh-carrier.js /runtime/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js web
120 110 120 /runtime/node/bin/node /runtime/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js web
121 120 120 /runtime/node/bin/node worker.js
130 100 100 Hermit Helper (Renderer)
`);
  const runtime = identifyHermitRuntime(rows, 100);
  assert.equal(runtime.carrier.pid, 110);
  assert.equal(runtime.dsh.pid, 120);
  assert.equal(runtime.dsh.groupId, 120);
  assert.deepEqual(runtime.dshDescendants.map(({ pid }) => pid), [121]);
  assert.deepEqual(descendantRows(rows, 100).map(({ pid }) => pid), [110, 130, 120, 121]);
});

test("Windows CIM identity 使用 PID + CreationDate，避免 PID 复用误判", () => {
  const rows = parseWindowsProcessSnapshot(JSON.stringify([{
    pid: 42,
    parentPid: 7,
    creationDate: "2026-08-27T01:02:03.0000000Z",
    executablePath: "C:\\Hermit\\node.exe",
    commandLine: '"C:\\Hermit\\node.exe" worker.js',
  }]));
  assert.equal(sameProcessExists(rows[0], rows), true);
  assert.equal(sameProcessExists(
    { ...rows[0], creationDate: "2026-08-27T01:02:04.0000000Z" },
    rows,
  ), false);
});

test("残留扫描只匹配当前 bundled Node 的 carrier/DSH entry", () => {
  const rows = parseWindowsProcessSnapshot(JSON.stringify([
    {
      pid: 10,
      parentPid: 1,
      creationDate: "a",
      executablePath: "C:\\Hermit\\node.exe",
      commandLine: '"C:\\Hermit\\node.exe" "C:\\Hermit\\dsh-carrier.js"',
    },
    {
      pid: 11,
      parentPid: 1,
      creationDate: "b",
      executablePath: "C:\\Other\\node.exe",
      commandLine: '"C:\\Other\\node.exe" "C:\\Hermit\\dsh-carrier.js"',
    },
  ]));
  const residue = findRuntimeResidue(rows, {
    nodeBinary: "C:\\Hermit\\node.exe",
    carrierEntry: "C:\\Hermit\\dsh-carrier.js",
    dshEntry: "C:\\Hermit\\dsh\\bin.js",
  });
  assert.deepEqual(residue.map(({ pid }) => pid), [10]);
});
