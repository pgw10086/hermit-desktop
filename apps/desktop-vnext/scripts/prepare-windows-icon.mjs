import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(scriptPath), "..");
const repositoryRoot = path.resolve(appRoot, "..", "..");

/** 将现有 PNG 原样封装为 Windows ICO，避免打包时依赖 icon-tool 的平台转换进程。 */
export function prepareWindowsIcon({
  sourcePath = path.join(appRoot, "assets", "brand", "hermit", "previews", "hermit-app-icon-256.png"),
  outputPath = path.join(repositoryRoot, ".hermit", "artifacts", "windows-app-icon.ico"),
} = {}) {
  const png = fs.readFileSync(sourcePath);
  const size = pngSize(png);
  if (size.width < 1 || size.height < 1 || size.width > 256 || size.height > 256) {
    throw new Error(`Windows icon PNG must be between 1 and 256px: ${size.width}x${size.height}`);
  }
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(size.width === 256 ? 0 : size.width, 6);
  header.writeUInt8(size.height === 256 ? 0 : size.height, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.concat([header, png]));
  return { outputPath, width: size.width, height: size.height, bytes: fs.statSync(outputPath).size };
}

function pngSize(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(signature) || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Windows icon source must be a valid PNG with an IHDR chunk");
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const result = prepareWindowsIcon();
    console.log(`Prepared Windows ICO: ${result.outputPath} (${result.width}x${result.height}, ${result.bytes} bytes)`);
  } catch (cause) {
    console.error(`[windows-icon] ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  }
}
