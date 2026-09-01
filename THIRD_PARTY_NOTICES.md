# Third-Party Notices

本文档记录 Hermit 使用或改编的第三方代码、来源提交和许可证正文。维护打包代码或发布
制品时必须同步核对这里的归属信息，不能删除或改写下方许可证原文。

## DSH Desktop adapted code

Hermit includes portions adapted from
[anywhere-labs/dsh-desktop](https://github.com/anywhere-labs/dsh-desktop), commit
`1eb398d78108de1303ce29b1aeaf70aaf96acee4`:

- native macOS DMG packaging control flow;
- signed release credential preflight;
- read-only DMG mount and artifact verification flow.
- main-window bounds persistence and stale-display fitting.

The adapted implementation was changed for Hermit's Apple Silicon-only delivery gate, external
carrier process model, bundled Node runtime and stock DSH generation layout.

```text
MIT License

Copyright (c) 2026 Anywhere Labs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## DeepSeek Harness adapted code

Hermit's bundled DSH generation includes a source-controlled adaptation of
[`@deepseek-ai/dsh-client-ui-layout`](https://github.com/deepseek-ai/deepseek-harness),
tag `dsh-v0.1.1-rc.2`, commit
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`.

Hermit also retains the unmodified DSH documentation and package README snapshots listed in
[`DEEPSEEK-HARNESS-UPSTREAM.md`](DEEPSEEK-HARNESS-UPSTREAM.md). Each snapshot keeps the upstream
`LICENSE` and `THIRD_PARTY_NOTICES.md`; its files are reference material, not a second Hermit
implementation.

The adaptation adds the public typed `product.surface` slot and
`ctx.layout.openProductSurface/closeProductSurface` contract used by Product Plugins. It does not
replace Conversation, Settings, the sidebar implementation, React, or the rest of the upstream
DSH Web shell.

```text
MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
