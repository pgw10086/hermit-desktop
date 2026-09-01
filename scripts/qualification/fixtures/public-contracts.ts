import type { ClientTransportHooks } from "@deepseek-ai/dsh-client-connection/client";
import { createClientModuleSystem } from "@deepseek-ai/dsh-client-modules/client";
import { AppWebEntry } from "@deepseek-ai/dsh-client-web";

export interface QualificationPublicContracts {
  /** 资格 fixture 使用的 stock DSH transport hook 契约。 */
  transport: ClientTransportHooks;
  /** 资格 fixture 使用的 stock DSH Client 模块加载器。 */
  createClientModuleSystem: typeof createClientModuleSystem;
  /** 用于生命周期资格检查的 stock DSH 根 Web 入口。 */
  AppWebEntry: typeof AppWebEntry;
}
