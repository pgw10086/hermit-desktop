#import "../src/pasteboard.h"

static void Require(BOOL condition, NSString *message) {
  if (condition) return;
  NSLog(@"FAILED: %@", message);
  exit(1);
}

static NSDictionary *Read(NSPasteboard *pasteboard, NSInteger previous) {
  return HCReadStableSnapshot(pasteboard, @(previous), nil);
}

int main(void) {
  @autoreleasepool {
    NSPasteboard *pasteboard = [NSPasteboard pasteboardWithUniqueName];
    NSDictionary *baseline = HCReadStableSnapshot(pasteboard, nil, nil);
    Require([baseline[@"status"] isEqualToString:@"baseline"], @"first read establishes baseline");

    NSDictionary *text = @{
      @"kind": @"TEXT",
      @"plain": @"Hermit rich text",
      @"htmlBase64": [[@"<b>Hermit rich text</b>" dataUsingEncoding:NSUTF8StringEncoding] base64EncodedStringWithOptions:0],
      @"rtfBase64": [[@"{\\rtf1 Hermit rich text}" dataUsingEncoding:NSUTF8StringEncoding] base64EncodedStringWithOptions:0],
    };
    NSDictionary *written = HCWriteSnapshot(pasteboard, text, @"operation-1", nil);
    Require([written[@"status"] isEqualToString:@"written"], @"rich text write succeeds");
    NSInteger textGeneration = [written[@"generation"] integerValue];
    NSDictionary *snapshot = Read(pasteboard, textGeneration - 1);
    Require([snapshot[@"status"] isEqualToString:@"snapshot"], @"rich text snapshot is visible");
    Require([snapshot[@"operationId"] isEqualToString:@"operation-1"], @"operation marker round-trips");
    Require([snapshot[@"snapshot"][@"kind"] isEqualToString:@"TEXT"], @"snapshot kind is TEXT");
    Require(snapshot[@"snapshot"][@"htmlBase64"] != nil && snapshot[@"snapshot"][@"rtfBase64"] != nil, @"HTML and RTF stay on the same item");
    Require([[Read(pasteboard, textGeneration) objectForKey:@"status"] isEqualToString:@"unchanged"], @"same generation is unchanged");

    NSArray *fileUrls = @[[NSURL fileURLWithPath:@"/tmp/a.txt"].absoluteString, [NSURL fileURLWithPath:@"/tmp/b.txt"].absoluteString];
    written = HCWriteSnapshot(pasteboard, @{ @"kind": @"FILE_LIST", @"fileUrls": fileUrls }, @"operation-2", nil);
    snapshot = Read(pasteboard, [written[@"generation"] integerValue] - 1);
    Require([snapshot[@"snapshot"][@"fileUrls"] isEqualToArray:fileUrls], @"file list preserves item order");

    NSPasteboardItem *ignoredItem = [[NSPasteboardItem alloc] init];
    [ignoredItem setString:@"ignored" forType:NSPasteboardTypeString];
    [ignoredItem setString:@"1" forType:@"org.nspasteboard.ConcealedType"];
    NSInteger beforeIgnored = [pasteboard clearContents];
    [pasteboard writeObjects:@[ignoredItem]];
    NSDictionary *ignored = Read(pasteboard, beforeIgnored - 1);
    Require([ignored[@"status"] isEqualToString:@"ignored"], @"concealed marker is ignored before payload capture");

    NSPasteboardItem *unsupportedItem = [[NSPasteboardItem alloc] init];
    [unsupportedItem setData:[@"x" dataUsingEncoding:NSUTF8StringEncoding] forType:@"io.github.pgw10086.hermit.unsupported"];
    NSInteger unsupportedGeneration = [pasteboard clearContents];
    [pasteboard writeObjects:@[unsupportedItem]];
    NSDictionary *unsupported = Read(pasteboard, unsupportedGeneration - 1);
    Require([unsupported[@"status"] isEqualToString:@"unsupported"], @"unsupported generation has a terminal state");

    NSPasteboardItem *oversizedText = [[NSPasteboardItem alloc] init];
    [oversizedText setString:[@"x" stringByPaddingToLength:(2 * 1024 * 1024 + 1) withString:@"x" startingAtIndex:0] forType:NSPasteboardTypeString];
    NSInteger oversizedGeneration = [pasteboard clearContents];
    [pasteboard writeObjects:@[oversizedText]];
    Require([[Read(pasteboard, oversizedGeneration - 1) objectForKey:@"status"] isEqualToString:@"unsupported"], @"oversized text is rejected before the JSON boundary");

    NSPasteboardItem *invalidImage = [[NSPasteboardItem alloc] init];
    [invalidImage setData:[@"not-an-image" dataUsingEncoding:NSUTF8StringEncoding] forType:NSPasteboardTypePNG];
    [invalidImage setString:@"fallback text must not win" forType:NSPasteboardTypeString];
    NSInteger invalidImageGeneration = [pasteboard clearContents];
    [pasteboard writeObjects:@[invalidImage]];
    Require([[Read(pasteboard, invalidImageGeneration - 1) objectForKey:@"status"] isEqualToString:@"unsupported"], @"invalid high-priority image does not silently become TEXT");

    NSDictionary *oversizedWrite = HCWriteSnapshot(pasteboard, @{
      @"kind": @"TEXT",
      @"plain": [@"x" stringByPaddingToLength:(2 * 1024 * 1024 + 1) withString:@"x" startingAtIndex:0],
    }, @"operation-oversized", nil);
    Require([oversizedWrite[@"status"] isEqualToString:@"failed"], @"oversized text write is rejected");

    written = HCWriteSnapshot(pasteboard, text, @"operation-3", nil);
    NSInteger stableGeneration = [written[@"generation"] integerValue];
    NSDictionary *unstable = HCReadStableSnapshot(pasteboard, @(stableGeneration - 1), ^{
      [pasteboard clearContents];
      [pasteboard setString:@"changed during read" forType:NSPasteboardTypeString];
    });
    Require([unstable[@"status"] isEqualToString:@"unstable"], @"generation change during read is rejected");

    NSDictionary *conflict = HCWriteSnapshot(pasteboard, text, @"operation-4", ^{
      [pasteboard clearContents];
      [pasteboard setString:@"competing owner" forType:NSPasteboardTypeString];
    });
    Require([conflict[@"status"] isEqualToString:@"conflict"], @"ownership loss during write is visible");

    [pasteboard releaseGlobally];
    NSLog(@"pasteboard bridge tests passed");
  }
  return 0;
}
