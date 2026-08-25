import { inspectClientModuleHostContract } from "./inspect-client-module-host.mjs";
import { qualificationExitCode } from "./qualification-status.mjs";

const result = await inspectClientModuleHostContract();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

process.exitCode = qualificationExitCode(result.status);
