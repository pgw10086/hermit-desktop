import { spawnSync } from "node:child_process";

const CARRIER_PATTERN = /(?:^|[\\/])dsh-carrier\.js(?:\s|"|$)/iu;
const DSH_PATTERN = /[\\/]@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js(?:"?\s+web(?:\s|$))/iu;

export function readProcessSnapshot(platform = process.platform) {
  if (platform === "win32") return readWindowsSnapshot();
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,pgid=,command="], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`ps process snapshot failed: ${result.stderr}`);
  return parsePosixProcessSnapshot(result.stdout);
}

export function parsePosixProcessSnapshot(output) {
  return output.trim().split("\n").map((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u.exec(line);
    return match === null ? undefined : {
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      groupId: Number(match[3]),
      commandLine: match[4],
    };
  }).filter((row) => row !== undefined);
}

export function parseWindowsProcessSnapshot(output) {
  const text = output.replace(/^\uFEFF/u, "").trim();
  if (text === "" || text === "null") return [];
  const parsed = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.map((row) => ({
    pid: Number(row.pid),
    parentPid: Number(row.parentPid),
    creationDate: String(row.creationDate ?? ""),
    executablePath: String(row.executablePath ?? ""),
    commandLine: String(row.commandLine ?? ""),
  })).filter(({ pid, parentPid }) => Number.isInteger(pid) && Number.isInteger(parentPid));
}

export function descendantRows(rows, rootPid) {
  const children = new Map();
  for (const row of rows) {
    const siblings = children.get(row.parentPid) ?? [];
    siblings.push(row);
    children.set(row.parentPid, siblings);
  }
  const found = [];
  const pending = [...(children.get(rootPid) ?? [])];
  while (pending.length > 0) {
    const row = pending.shift();
    found.push(row);
    pending.push(...(children.get(row.pid) ?? []));
  }
  return found;
}

export function identifyHermitRuntime(rows, electronMainPid) {
  const descendants = descendantRows(rows, electronMainPid);
  const carrier = descendants.find(({ commandLine }) => CARRIER_PATTERN.test(commandLine));
  if (carrier === undefined) throw new Error("packaged Hermit has no carrier descendant");
  const dsh = rows.find(({ parentPid, commandLine }) =>
    parentPid === carrier.pid && DSH_PATTERN.test(commandLine));
  if (dsh === undefined) throw new Error("packaged Hermit carrier has no direct DSH child");
  return {
    carrier,
    dsh,
    dshDescendants: descendantRows(rows, dsh.pid),
  };
}

export function sameProcessExists(identity, rows) {
  return rows.some((row) => row.pid === identity.pid && (
    identity.creationDate === undefined || identity.creationDate === row.creationDate
  ));
}

export function findRuntimeResidue(rows, { carrierEntry, dshEntry, nodeBinary }) {
  const carrier = normalizePathForMatch(carrierEntry);
  const dsh = normalizePathForMatch(dshEntry);
  const node = normalizePathForMatch(nodeBinary);
  return rows.filter((row) => {
    const executable = normalizePathForMatch(row.executablePath ?? "");
    const command = normalizePathForMatch(row.commandLine);
    if (executable !== "" && executable !== node) return false;
    return command.includes(carrier) || command.includes(dsh);
  });
}

function readWindowsSnapshot() {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$rows = @(Get-CimInstance Win32_Process | ForEach-Object {",
    "  [pscustomobject]@{",
    "    pid = [int]$_.ProcessId",
    "    parentPid = [int]$_.ParentProcessId",
    "    creationDate = if ($null -eq $_.CreationDate) { '' } else { $_.CreationDate.ToUniversalTime().ToString('o') }",
    "    executablePath = [string]$_.ExecutablePath",
    "    commandLine = [string]$_.CommandLine",
    "  }",
    "})",
    "ConvertTo-Json -Compress -Depth 3 -InputObject $rows",
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true },
  );
  if (result.status !== 0) {
    throw new Error(`Windows CIM process snapshot failed: ${result.stderr}`);
  }
  return parseWindowsProcessSnapshot(result.stdout);
}

function normalizePathForMatch(value) {
  return value.replaceAll("\\", "/").replaceAll('"', "").toLowerCase();
}
