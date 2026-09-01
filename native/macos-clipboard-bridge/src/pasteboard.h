#import <AppKit/AppKit.h>

// 原生桥只暴露稳定快照、带 generation 的写入和目标应用粘贴能力；其余权限与校验留在实现内。
typedef void (^HCPasteboardTestHook)(void);

// 读取期间 changeCount 发生变化时返回 unstable，调用方应等待下一轮而不是记录中间态。
NSDictionary *HCReadStableSnapshot(NSPasteboard *pasteboard, NSNumber *lastGeneration, HCPasteboardTestHook hook);
// 写入携带 operationId，并在返回前验证 changeCount 和标记，避免误把并发写入当作成功。
NSDictionary *HCWriteSnapshot(NSPasteboard *pasteboard, NSDictionary *payload, NSString *operationId, HCPasteboardTestHook hook);
// 捕获当前前台应用身份，供自动粘贴恢复目标窗口。
NSDictionary *HCCaptureFrontmostApplication(void);
// 请求恢复目标应用焦点；无法确认身份时返回 copy-only 原因。
NSDictionary *HCRequestActivate(NSDictionary *identity);
// 仅在目标身份、generation 和 operationId 都一致时发送粘贴事件。
NSDictionary *HCPostPasteIfCurrent(NSPasteboard *pasteboard, NSDictionary *identity, NSString *operationId, NSInteger generation);
