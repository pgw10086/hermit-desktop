# 文档语言规范

本文档定义 Hermit vNext 第一方维护性文档的语言规则。根 `AGENTS.md` 只保留执行
所需摘要和本文入口；语言治理细节以本文为准。

文档事实应放在哪里、历史信息何时允许出现，由
`docs/development/documentation-rules.md` 负责。

## 适用范围

本规则适用于项目维护者编写和维护的 Markdown，包括：

- 根目录和各 scope 的 `AGENTS.md`；
- 项目、组件和目录的 `README.md`；
- `CONTRIBUTING.md`、`SECURITY.md`；
- `docs/` 下的第一方架构、契约、开发和研究文档；
- GitHub PR/Issue 模板中的维护说明；
- `specs/` 下用于解释规格、目录结构或维护方式的 `README.md`。

本规则不自动扩展到源代码、代码注释、commit message、schema description、用户
界面文案或其他非 Markdown 内容。

## 默认语言和权威关系

第一方维护性 Markdown 默认使用简体中文。

同一工程事实只维护一个 canonical 来源。不得通过逐段中英双语、中文文件加英文
副本或两个 README 同时维护相同事实的方式建立并列权威。

需要英文公开入口时，可以创建明确标记为派生翻译的英文文件。中文 canonical
文档仍是工程事实来源；译文不得增加、修改或独立维护规范性事实。

英文派生文件必须在文件开头声明：

```html
<!-- translation-of: <canonical-path>; canonical-language: zh-CN -->
```

## 保持原文的内容

以下内容不要求翻译：

- `LICENSE` 中的标准许可证法律文本；
- `NOTICE` 和第三方 notice/license 原文；
- 上游规范、标准或第三方资料的逐字引用；
- fenced code block 和 inline code 中的代码、命令、配置与示例数据；
- 文件名、目录名、代码标识符和命令；
- API 名称、schema key、协议字段和值；
- DSH package、export、slot、token 等正式标识；
- 错误码、版本号、URL 和官方产品/项目名称；
- 为测试、fixture、snapshot 或生成流程保留的原始文本。

项目自己的解释、上下文和结论仍使用简体中文。

如需在 Markdown 中保留大段官方英文原文，使用局部标记：

```html
<!-- doc-lang: allow-en-start; reason=upstream-verbatim -->
> Upstream text...
<!-- doc-lang: allow-en-end -->
```

## 技术术语

不要为了中文化而修改正式标识符，也不要使用音译替代已有英文术语。

面向维护者的概念第一次出现时，优先使用：

```text
中文解释（English Original；必要时附 codeIdentifier）
```

例如：

- 系统边界（System Boundaries）；
- 产品插件（Product Plugin）；
- 运行时 Agent（Runtime Agent）；
- 能力中介组件（Capability Broker；实现名为 `CapabilityBroker` 时保留代码名）。

首次定义后，在同一文档中使用稳定且不歧义的简称。正式组件名、类型名或代码
标识符需要与实现对应时继续使用英文原名。同一概念不得自行创造多个中文译名。

## 用户文案和代码文本

“维护性 Markdown 使用中文”不等于“仓库所有文本使用中文”。

- UI、CLI 和其他用户可见文案遵循产品与本地化要求；
- 代码注释和 docstring 遵循所属代码区域规范；
- commit message 遵循版本控制约定；
- schema description、OpenAPI/JSON Schema 描述遵循接口兼容和发布要求；
- 外部协议固定字符串保持协议原文。

不得以语言迁移为理由批量修改上述内容。

## AGENTS 文档

根 `AGENTS.md` 保持短小，只记录跨仓必须立即执行的规则和 canonical 文档入口。
scoped `AGENTS.md` 只描述相对上级新增或不同的要求，不重复根规则，也不复制架构
事实。

`CLAUDE.md` 必须精确保持：

```text
@AGENTS.md
```

不得在 `CLAUDE.md` 中维护另一套项目规则。

## README 和英文翻译

Private incubation 阶段，根 `README.md` 是中文 canonical README。不得同时维护
内容等价的 `README.md` 和 `README.zh-CN.md`。

未来需要英文公开入口时，创建 `README.en.md` 作为 `README.md` 的派生翻译，并
添加 `translation-of` 声明。英文 README 应尽量链接到中文 canonical 深层文档，
避免复制高频变化的工程事实。

公开时是否调整 GitHub 默认入口属于公开门决策，不在当前语言迁移中提前处理。

## 自动检查

CI 应检查 tracked 第一方维护性 Markdown，但不得要求每行或每段都含中文。

检查器应忽略代码块、inline code、链接目标、允许的原文区块和集中 allowlist，
然后确认有效 prose 包含足够中文。不要使用固定中文字符百分比。

新增 `*.en.md`、`*.zh-CN.md` 或 `*.zh.md` 时必须检查：

- 派生翻译声明 canonical 来源；
- canonical 文件真实存在；
- 已有中文无后缀 canonical 时，不得再增加平行 `*.zh-CN.md`；
- 同 stem 的多语言文件不能都自称权威。

CI 只验证语言类别、canonical 关系、明显 English-only 回退和非法平行权威；译文
语义等价由 review 保证。

## 修改和复核顺序

1. 先修改根 `AGENTS.md` 和 scoped `AGENTS.md`；
2. 再修改 architecture、contracts、development、research 等 canonical 文档；
3. 最后修改 README、贡献/安全文档和 GitHub 模板；
4. 删除重复语言副本，复核所有 pointer 和本地链接；
5. 检查核心术语首次出现形式和 identifier 是否保持原文；
6. 运行文档语言、Agent contract、Markdown link/fence 检查；
7. 用编码 Agent 做文档/代码 smoke test，确认规则不会外溢到代码或用户文案。
