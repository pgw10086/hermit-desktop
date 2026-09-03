# DSH Runtime Host

这个 package 只作为 `pnpm deploy` 的产品级依赖根，生成不含 Electron、Desktop Core 和
业务源码的 DSH runtime 闭包。Hermit Layout 和 Product Plugin 随后由 Package Gate 从
固定 tarball 物化并校验摘要。

它不是公共 SDK，也没有运行时代码；版本与 Hermit Desktop 发布候选同步。
