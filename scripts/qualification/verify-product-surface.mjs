import { inspectProductSurfaceContract } from "./inspect-product-surface.mjs";
import { qualificationExitCode } from "./qualification-status.mjs";

const result = await inspectProductSurfaceContract();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = qualificationExitCode(result.status);
