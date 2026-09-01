import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDir, '..', '..', '..');
const runtimeRoot = path.join(repositoryRoot, '.hermit', 'runtime', 'node');
const tempParent = path.join(repositoryRoot, '.hermit', 'tmp');
const version = fs.readFileSync(path.join(repositoryRoot, '.node-version'), 'utf8').trim();

const platform = process.platform;
const architecture = process.arch;
if (!['win32', 'linux', 'darwin'].includes(platform)) {
  throw new Error('Unsupported Node runtime platform: ' + platform);
}
if (!['x64', 'arm64'].includes(architecture)) {
  throw new Error('Unsupported Node runtime architecture: ' + architecture);
}

const osName = platform === 'win32' ? 'win' : platform;
const extension = platform === 'win32' ? 'zip' : 'tar.gz';
const folderName = 'node-v' + version + '-' + osName + '-' + architecture;
const archiveName = folderName + '.' + extension;
const baseUrl = 'https://nodejs.org/dist/v' + version;

if (!process.argv.includes('--refresh') && isReusableRuntime()) {
  console.log('Reused Node ' + version + ' runtime at ' + runtimeRoot);
} else {
  fs.mkdirSync(tempParent, { recursive: true });
  const temp = fs.mkdtempSync(path.join(tempParent, 'node-runtime-'));

  try {
    const [checksums, archive] = await Promise.all([
      downloadText(baseUrl + '/SHASUMS256.txt'),
      downloadBytes(baseUrl + '/' + archiveName),
    ]);
    const checksumLine = checksums
      .split(/\r?\n/u)
      .find((line) => line.endsWith('  ' + archiveName));
    if (checksumLine === undefined) throw new Error('Node checksum is missing for ' + archiveName);
    const expected = checksumLine.split(/\s+/u)[0];
    const actual = createHash('sha256').update(archive).digest('hex');
    if (actual !== expected) throw new Error('Node runtime checksum mismatch for ' + archiveName);

    const archivePath = path.join(temp, archiveName);
    const extractedPath = path.join(temp, 'extracted');
    fs.writeFileSync(archivePath, archive);
    fs.mkdirSync(extractedPath);

    if (platform === 'win32') {
      const powerShell = process.env.SystemRoot
        ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
        : 'powershell.exe';
      const extractorPath = path.join(temp, 'extract-node-runtime.ps1');
      fs.writeFileSync(
        extractorPath,
        "param([string]$Archive, [string]$Destination)\nExpand-Archive -LiteralPath $Archive -DestinationPath $Destination\n",
      );
      await execFileAsync(
        powerShell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          extractorPath,
          archivePath,
          extractedPath,
        ],
        { windowsHide: true },
      );
    } else {
      await execFileAsync('tar', ['-xzf', archivePath, '-C', extractedPath]);
    }

    const extractedRuntime = path.join(extractedPath, folderName);
    if (!fs.existsSync(extractedRuntime)) throw new Error('Extracted Node runtime root is missing');
    assertManagedRuntimePath(runtimeRoot);
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(runtimeRoot), { recursive: true });
    fs.renameSync(extractedRuntime, runtimeRoot);
    fs.writeFileSync(
      path.join(runtimeRoot, 'hermit-runtime.json'),
      JSON.stringify({ version, platform, architecture, archiveName, sha256: actual }, null, 2) + '\n',
    );
    console.log('Prepared Node ' + version + ' runtime at ' + runtimeRoot);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function isReusableRuntime() {
  const manifestPath = path.join(runtimeRoot, 'hermit-runtime.json');
  const nodeBinary = path.join(
    runtimeRoot,
    platform === 'win32' ? 'node.exe' : path.join('bin', 'node'),
  );
  if (!fs.existsSync(manifestPath) || !fs.existsSync(nodeBinary)) return false;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (
      manifest.version !== version ||
      manifest.platform !== platform ||
      manifest.architecture !== architecture ||
      manifest.archiveName !== archiveName ||
      !/^[a-f0-9]{64}$/u.test(manifest.sha256 ?? '')
    ) {
      return false;
    }
    const smoke = spawnSync(nodeBinary, ['--version'], { encoding: 'utf8', windowsHide: true });
    return smoke.status === 0 && smoke.stdout.trim() === 'v' + version;
  } catch {
    return false;
  }
}

function assertManagedRuntimePath(target) {
  const allowedRoot = path.join(repositoryRoot, '.hermit', 'runtime');
  if (!target.startsWith(allowedRoot + path.sep)) {
    throw new Error('Refusing to replace unmanaged runtime path: ' + target);
  }
}

async function downloadText(url) {
  return Buffer.from(await downloadBytes(url)).toString('utf8');
}

async function downloadBytes(url) {
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) throw new Error('Download failed (' + String(response.status) + '): ' + url);
  return Buffer.from(await response.arrayBuffer());
}
