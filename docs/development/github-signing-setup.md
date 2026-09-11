# GitHub Release 签名配置与发布操作清单

状态：current

本文是 hermit-desktop 正式 Release 的现场清单。当前 v0.2.3 已创建并指向通过双平台
Candidate 的 main，但正式 workflow 会在签名输入缺失时 fail closed。你按本文配置完成后，
直接重跑已有 workflow，不需要重新创建 tag，也不要把证书、密码或私钥发到聊天中。

## 1. 当前实现的边界

正式 workflow 使用：

- macOS Developer ID Application .p12（必须包含私钥）和 App Store Connect Team API Key .p8；
- Windows 文件型 Authenticode .pfx/.p12（必须包含私钥）和密码；
- GitHub Environment secrets；
- production-release Environment 的人工审批。

当前不支持：macOS ad-hoc 证书、只有公钥的 .cer、Windows EV USB 证书、Azure Trusted
Signing，以及把证书写进 Git 或 Actions artifact。GitHub 单个 secret 上限是 48 KB；超出时
不要拆 secret，应先改成受支持的云签名方案。

## 2. 先确认 GitHub 权限

本机需要已登录且拥有仓库管理权限：

    gh auth status
    gh api repos/pgw10086/hermit-desktop --jq '{visibility,default_branch}'

应看到 visibility 为 public、default_branch 为 main。配置 secret 时不要使用 set -x，也
不要把密码写入命令行参数。

## 3. 准备 macOS 材料

### 3.1 Developer ID Application

1. 打开 Apple Developer Certificates：
   https://developer.apple.com/account/resources/certificates/list
2. 点击 Certificates → + → 选择 Developer ID Application。
3. 在 Keychain Access 的证书助理中创建 CSR，上传 CSR，下载 .cer 并双击导入。
4. 在 Keychain Access → My Certificates 确认该证书下面同时有私钥。
5. 将证书和私钥导出为加密 .p12，记住导出密码。

检查 identity：

    security find-identity -v -p codesigning | rg 'Developer ID Application'

CSC_NAME 使用输出中的完整 identity，例如：
Developer ID Application: Example Company (ABCDE12345)。

### 3.2 App Store Connect Team API Key

1. 打开 App Store Connect API：https://appstoreconnect.apple.com/access/api
2. Users and Access → Integrations → App Store Connect API → Team Keys。
3. 生成 Team Key，按最小权限原则选择可用于 notarization 的角色。
4. 下载 .p8 文件，并记录 Key ID 和页面上的 Issuer ID。

必须用 Team Key；Apple 官方说明 Individual API Key 不能用于 notaryTool。.p8 私钥只
能下载一次，丢失后只能撤销并重新生成。

### 3.3 检查 secret 大小

只输出 base64 长度，不输出内容：

    base64 < DeveloperIDApplication.p12 | tr -d '\n' | wc -c
    base64 < AuthKey_ABC123XYZ.p8 | tr -d '\n' | wc -c

每个结果必须小于 48 KB。

## 4. 写入 macOS Environment secrets

进入仓库目录，下面的证书命令通过标准输入传值：

    cd /Users/pgw/Developer/codes/hermit-platform/hermit-desktop

    base64 < DeveloperIDApplication.p12 | tr -d '\n' | gh secret set --repo pgw10086/hermit-desktop --env macos-signing CSC_LINK

    gh secret set --repo pgw10086/hermit-desktop --env macos-signing CSC_KEY_PASSWORD
    gh secret set --repo pgw10086/hermit-desktop --env macos-signing CSC_NAME

    base64 < AuthKey_ABC123XYZ.p8 | tr -d '\n' | gh secret set --repo pgw10086/hermit-desktop --env macos-signing APPLE_API_KEY_BASE64

    gh secret set --repo pgw10086/hermit-desktop --env macos-signing APPLE_API_KEY_ID
    gh secret set --repo pgw10086/hermit-desktop --env macos-signing APPLE_API_ISSUER

注意：CSC_LINK 是 .p12 的 base64，APPLE_API_KEY_BASE64 是 .p8 的 base64；Issuer ID
不是 Team ID。workflow 会把 .p8 解码到 macOS runner 临时目录，构建结束后销毁。

如果选择 Apple ID notarization，则改为完整配置：

    gh secret set --repo pgw10086/hermit-desktop --env macos-signing APPLE_ID
    gh secret set --repo pgw10086/hermit-desktop --env macos-signing APPLE_APP_SPECIFIC_PASSWORD
    gh secret set --repo pgw10086/hermit-desktop --env macos-signing APPLE_TEAM_ID

不要混用不完整的 API Key 三元组和 Apple ID 三元组。

## 5. 准备并写入 Windows 签名

当前 workflow 使用 PFX/P12 文件型签名；EV USB 证书和 Azure Trusted Signing 不在当前范围。

在 Windows PowerShell 中：

    $pfx = '.\Hermit-CodeSigning.pfx'
    (Get-PfxCertificate $pfx).Subject
    [Convert]::ToBase64String([IO.File]::ReadAllBytes($pfx)) | Set-Content -NoNewline '.\Hermit-CodeSigning.pfx.base64'
    (Get-Content '.\Hermit-CodeSigning.pfx.base64' -Raw).Length

长度必须小于 48 KB。将 base64 和密码写入 windows-signing：

    gh secret set --repo pgw10086/hermit-desktop --env windows-signing WIN_CSC_LINK < .\Hermit-CodeSigning.pfx.base64
    gh secret set --repo pgw10086/hermit-desktop --env windows-signing WIN_CSC_KEY_PASSWORD

再设置 Environment variable（不是 secret）：

    gh variable set --repo pgw10086/hermit-desktop --env windows-signing WINDOWS_SIGNER_SUBJECT --body 'Example Company'

WINDOWS_SIGNER_SUBJECT 是签名者回验值，不是密码。electron-builder 官方使用
WIN_CSC_LINK 和 WIN_CSC_KEY_PASSWORD 读取文件型证书。

## 6. 配置正式审批人

进入：

GitHub → pgw10086/hermit-desktop → Settings → Environments → production-release

1. 在 Required reviewers 增加另一位 GitHub 用户；
2. 保持 Prevent self-review 开启；
3. 不要在该环境存放签名文件。

发布流程到达此环境后，第二位 reviewer 必须在 Actions 页面批准，批准后才会把 Draft 发布。

## 7. 只读核对

以下命令只显示名称，不显示 secret 值：

    gh secret list --repo pgw10086/hermit-desktop --env macos-signing
    gh secret list --repo pgw10086/hermit-desktop --env windows-signing
    gh variable list --repo pgw10086/hermit-desktop --env windows-signing
    gh api repos/pgw10086/hermit-desktop/environments --jq '.environments[] | {name,protection_rules,deployment_branch_policy}'

期望名称：

    macos-signing: CSC_LINK, CSC_KEY_PASSWORD, CSC_NAME, APPLE_API_KEY_BASE64, APPLE_API_KEY_ID, APPLE_API_ISSUER
    windows-signing: WIN_CSC_LINK, WIN_CSC_KEY_PASSWORD
    windows-signing variable: WINDOWS_SIGNER_SUBJECT

## 8. 重跑 v0.2.3

确认 tag 仍指向当前发布 commit：

    git ls-remote origin refs/tags/v0.2.3^{}

当前应指向 57460de...。配置完成后重跑已有失败的正式 workflow：

    gh run rerun 34430131506 --repo pgw10086/hermit-desktop
    gh run watch 34430131506 --repo pgw10086/hermit-desktop

正常顺序：

    预检 → macOS 签名/公证 → Windows 签名 → 聚合 → Draft → GitHub 下载回验
    → production-release 审批 → 正式发布 → 发布后回读

## 9. 完成判定

只有同时满足以下条件才算发布完成：

- macOS 签名、公证、staple 通过；
- Windows Authenticode 和 signer subject 通过；
- Aggregate、Draft 上传和 GitHub 下载回验通过；
- 第二位 reviewer 批准；
- gh release view v0.2.3 --json tagName,isDraft,isImmutable,targetCommitish,assets 显示非 Draft、immutable；
- tag、Release manifest、SHA256SUMS 和安装包摘要一致。

## 官方参考

- Apple Developer ID certificates：
  https://developer.apple.com/help/account/certificates/create-developer-id-certificates/
- Apple App Store Connect API：
  https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api
- Apple API keys and notaryTool：
  https://developer.apple.com/documentation/appstoreconnectapi/creating-api-keys-for-app-store-connect-api
- GitHub Actions secrets：
  https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets
- electron-builder macOS signing：
  https://www.electron.build/docs/features/code-signing/code-signing-mac/
- electron-builder Windows signing：
  https://www.electron.build/docs/features/code-signing/code-signing-win/
