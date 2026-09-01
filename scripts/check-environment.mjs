import { evaluateEnvironment, toolchainPolicy } from "./toolchain-policy.mjs";

const requiredMode = readOption("--require");
if (requiredMode !== undefined && !["install", "qualification"].includes(requiredMode)) {
  throw new Error(`Unsupported environment gate: ${requiredMode}`);
}

const result = evaluateEnvironment({
  targetPlatform: readOption("--target-platform") ?? process.platform,
  targetArchitecture: readOption("--target-arch") ?? process.arch,
});

process.stdout.write(`${JSON.stringify({ schemaVersion: 1, policy: toolchainPolicy, ...result }, null, 2)}\n`);

if (requiredMode !== undefined && !result.qualificationEligible) {
  process.stderr.write(
    `${requiredMode} gate requires project-verified Node and pnpm on the native target. ` +
      "Run `pnpm doctor` for the observed status; read-only diagnostics remain available.\n",
  );
  process.exitCode = 1;
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}
