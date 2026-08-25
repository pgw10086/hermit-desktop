import type { ClientTransportHooks } from "@deepseek-ai/dsh-client-connection/client";
import { createClientModuleSystem } from "@deepseek-ai/dsh-client-modules/client";
import { AppWebEntry } from "@deepseek-ai/dsh-client-web";

export interface QualificationPublicContracts {
  transport: ClientTransportHooks;
  createClientModuleSystem: typeof createClientModuleSystem;
  AppWebEntry: typeof AppWebEntry;
}
