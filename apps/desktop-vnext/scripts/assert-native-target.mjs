import { fileURLToPath } from "node:url";
import path from "node:path";

/** 校验发布目标与当前宿主平台、架构一致，并返回最终 target。 */
export function assertNativeTarget({
  hostPlatform = process.platform,
  hostArchitecture = process.arch,
  targetPlatform = hostPlatform,
  targetArchitecture = hostArchitecture,
} = {}) {
  if (targetPlatform !== hostPlatform || targetArchitecture !== hostArchitecture) {
    throw new Error(
      `Hermit release builds are native-only: host=${hostPlatform}-${hostArchitecture}, ` +
        `target=${targetPlatform}-${targetArchitecture}`,
    );
  }
  return { platform: targetPlatform, architecture: targetArchitecture };
}

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = assertNativeTarget({
    targetPlatform: readOption("--platform", process.platform),
    targetArchitecture: readOption("--arch", process.arch),
  });
  process.stdout.write(`Native package target: ${result.platform}-${result.architecture}\n`);
}
