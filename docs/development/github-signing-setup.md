# GitHub Release 签名配置

状态：`current`

本文说明 `hermit-desktop` 正式 Release 所需的签名输入。签名文件和密码只进入 GitHub
Environment secrets，不进入仓库、Actions artifact、日志或 release manifest。GitHub secret
应通过 Environment 配置；workflow 只有在对应 Environment job 开始后才能读取这些值。

## Environment

正式 workflow 使用三个 Environment：

- `macos-signing`：macOS Developer ID 和 notarization 输入；
- `windows-signing`：Windows Authenticode 输入；
- `production-release`：发布前人工审批，不放签名文件。

`production-release` 当前禁止发起者自审，需要至少另一位 reviewer。不要把签名 secrets 放在
repository secrets 或个人 shell profile 中。

## macOS

准备一份包含 Developer ID Application 私钥的 `.p12`，以及 Apple Developer 的 App Store
Connect API key `.p8`。将文件转为 base64 后写入 Environment secrets：

```sh
base64 < DeveloperIDApplication.p12 | tr -d '\n' | gh secret set --env macos-signing CSC_LINK
gh secret set --env macos-signing CSC_KEY_PASSWORD
gh secret set --env macos-signing CSC_NAME
base64 < AuthKey_ABC123XYZ.p8 | tr -d '\n' | gh secret set --env macos-signing APPLE_API_KEY_BASE64
gh secret set --env macos-signing APPLE_API_KEY_ID
gh secret set --env macos-signing APPLE_API_ISSUER
```

`desktop-release.yml` 会在 macOS runner 的临时目录把 `APPLE_API_KEY_BASE64` 解码成 `.p8`，
再把路径交给 electron-builder；构建结束后 runner 会销毁。`CSC_LINK` 支持 base64 的
`.p12` 内容，`CSC_KEY_PASSWORD` 解锁私钥，`CSC_NAME` 用于固定 Developer ID identity。

如果不使用 API key，也可以改用完整的 Apple ID 方案：

```sh
gh secret set --env macos-signing APPLE_ID
gh secret set --env macos-signing APPLE_APP_SPECIFIC_PASSWORD
gh secret set --env macos-signing APPLE_TEAM_ID
```

此时不要配置不完整的 `APPLE_API_KEY_ID`/`APPLE_API_ISSUER` 组合。正式 workflow 选择
`required`，缺少任一必要输入会 fail closed，不会自动降级为 unsigned。

## Windows

准备包含私钥的 Authenticode `.pfx`/`.p12`，并确认签名证书 Subject。将证书转为 base64：

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('.\Hermit-CodeSigning.pfx')) |
  Set-Content -NoNewline .\Hermit-CodeSigning.pfx.base64
gh secret set --env windows-signing WIN_CSC_LINK < .\Hermit-CodeSigning.pfx.base64
gh secret set --env windows-signing WIN_CSC_KEY_PASSWORD
gh variable set --env windows-signing WINDOWS_SIGNER_SUBJECT --body 'Your Company Name'
```

`WIN_CSC_LINK` 和 `WIN_CSC_KEY_PASSWORD` 由 electron-builder 使用；`WINDOWS_SIGNER_SUBJECT`
是 workflow 回验签名者时的预期 Subject，不是密码。Windows job 运行在原生 Windows x64
runner，安装包、`elevate.exe` 和 bundled runtime 都会被签名并由 `signtool` 回验。

## 发布前只读检查

不能读取 secret 内容，只检查名称是否存在：

```sh
gh secret list --repo pgw10086/hermit-desktop --env macos-signing
gh secret list --repo pgw10086/hermit-desktop --env windows-signing
gh variable list --repo pgw10086/hermit-desktop --env windows-signing
```

然后确认第二位 `production-release` reviewer 已配置，再确认当前 `main` 的 Candidate
success，最后创建与 `apps/desktop-vnext/package.json` 一致的 `v0.2.3` tag。不要把 `.p12`、
`.pfx`、`.p8`、密码或 base64 内容提交到 Git。

## 参考

- [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
- [electron-builder macOS signing](https://www.electron.build/docs/features/code-signing/code-signing-mac/)
- [electron-builder Windows signing](https://www.electron.build/docs/features/code-signing/code-signing-win/)
