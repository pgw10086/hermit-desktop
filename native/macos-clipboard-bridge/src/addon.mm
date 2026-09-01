#include <node_api.h>
#include <pthread.h>
#include <string>
#import "pasteboard.h"

// N-API 适配层只负责线程、参数和 JSON 边界，业务校验由 pasteboard 实现统一完成。
static void HCCheck(napi_env env, napi_status status, const char *message) {
  if (status != napi_ok) napi_throw_error(env, NULL, message);
}

// AppKit pasteboard 和辅助功能 API 必须在 Electron 主线程执行。
static bool HCRequireMainThread(napi_env env) {
  if (pthread_main_np() != 0) return true;
  napi_throw_error(env, "ERR_MACOS_BRIDGE_WRONG_THREAD", "macOS clipboard bridge must run on the Electron main thread");
  return false;
}

// 从 JS 读取 UTF-8 字符串，错误直接转换为 N-API 异常。
static NSString *HCStringArgument(napi_env env, napi_value value) {
  size_t length = 0;
  HCCheck(env, napi_get_value_string_utf8(env, value, NULL, 0, &length), "expected a UTF-8 string");
  std::string buffer(length + 1, '\0');
  HCCheck(env, napi_get_value_string_utf8(env, value, buffer.data(), buffer.size(), &length), "failed to read UTF-8 string");
  return [[NSString alloc] initWithBytes:buffer.data() length:length encoding:NSUTF8StringEncoding];
}

// 读取并限制为 JSON object，阻止任意 JS 值进入原生层。
static NSDictionary *HCObjectArgument(napi_env env, napi_value value) {
  NSString *json = HCStringArgument(env, value);
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  id object = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![object isKindOfClass:NSDictionary.class]) {
    napi_throw_type_error(env, NULL, "expected a JSON object");
    return nil;
  }
  return object;
}

// 将原生结果序列化为稳定 JSON，供 TypeScript 边界再次解析。
static napi_value HCJsonResult(napi_env env, id object) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:object ?: NSNull.null options:NSJSONWritingSortedKeys error:nil];
  NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  napi_value result;
  HCCheck(env, napi_create_string_utf8(env, json.UTF8String, NAPI_AUTO_LENGTH, &result), "failed to return JSON result");
  return result;
}

// N-API readStableSnapshot 入口。
static napi_value HCRead(napi_env env, napi_callback_info info) {
  if (!HCRequireMainThread(env)) return NULL;
  size_t argc = 1; napi_value argv[1];
  HCCheck(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL), "failed to read arguments");
  NSNumber *last = nil;
  if (argc == 1) {
    int64_t value;
    HCCheck(env, napi_get_value_int64(env, argv[0], &value), "lastGeneration must be an integer");
    last = @(value);
  }
  @autoreleasepool { return HCJsonResult(env, HCReadStableSnapshot(NSPasteboard.generalPasteboard, last, nil)); }
}

// N-API writeSnapshot 入口。
static napi_value HCWrite(napi_env env, napi_callback_info info) {
  if (!HCRequireMainThread(env)) return NULL;
  size_t argc = 2; napi_value argv[2];
  HCCheck(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL), "failed to read arguments");
  if (argc != 2) { napi_throw_type_error(env, NULL, "writeSnapshot requires payload JSON and operationId"); return NULL; }
  @autoreleasepool {
    NSDictionary *payload = HCObjectArgument(env, argv[0]);
    if (payload == nil) return NULL;
    return HCJsonResult(env, HCWriteSnapshot(NSPasteboard.generalPasteboard, payload, HCStringArgument(env, argv[1]), nil));
  }
}

// N-API captureFrontmostApplication 入口。
static napi_value HCCapture(napi_env env, napi_callback_info info) {
  if (!HCRequireMainThread(env)) return NULL;
  @autoreleasepool { return HCJsonResult(env, HCCaptureFrontmostApplication()); }
}

// N-API requestActivate 入口。
static napi_value HCActivate(napi_env env, napi_callback_info info) {
  if (!HCRequireMainThread(env)) return NULL;
  size_t argc = 1; napi_value argv[1];
  HCCheck(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL), "failed to read arguments");
  if (argc != 1) { napi_throw_type_error(env, NULL, "requestActivate requires target JSON"); return NULL; }
  @autoreleasepool {
    NSDictionary *target = HCObjectArgument(env, argv[0]);
    return target == nil ? NULL : HCJsonResult(env, HCRequestActivate(target));
  }
}

// N-API postPasteIfCurrent 入口。
static napi_value HCPost(napi_env env, napi_callback_info info) {
  if (!HCRequireMainThread(env)) return NULL;
  size_t argc = 3; napi_value argv[3];
  HCCheck(env, napi_get_cb_info(env, info, &argc, argv, NULL, NULL), "failed to read arguments");
  if (argc != 3) { napi_throw_type_error(env, NULL, "postPasteIfCurrent requires target JSON, operationId and generation"); return NULL; }
  @autoreleasepool {
    NSDictionary *target = HCObjectArgument(env, argv[0]);
    if (target == nil) return NULL;
    int64_t generation;
    HCCheck(env, napi_get_value_int64(env, argv[2], &generation), "generation must be an integer");
    return HCJsonResult(env, HCPostPasteIfCurrent(NSPasteboard.generalPasteboard, target, HCStringArgument(env, argv[1]), generation));
  }
}

// 注册固定的公开方法集合，避免运行时动态注入未审计能力。
static napi_value HCInit(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    { "readStableSnapshot", NULL, HCRead, NULL, NULL, NULL, napi_default, NULL },
    { "writeSnapshot", NULL, HCWrite, NULL, NULL, NULL, napi_default, NULL },
    { "captureFrontmostApplication", NULL, HCCapture, NULL, NULL, NULL, napi_default, NULL },
    { "requestActivate", NULL, HCActivate, NULL, NULL, NULL, napi_default, NULL },
    { "postPasteIfCurrent", NULL, HCPost, NULL, NULL, NULL, napi_default, NULL },
  };
  HCCheck(env, napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties), "failed to define native exports");
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, HCInit)
