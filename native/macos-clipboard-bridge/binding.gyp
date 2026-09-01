{
  "targets": [
    {
      "target_name": "hermit_macos_clipboard_bridge",
      "sources": [
        "src/addon.mm",
        "src/pasteboard.mm"
      ],
      "defines": [
        "NAPI_VERSION=8"
      ],
      "conditions": [
        ["OS=='mac'", {
          "xcode_settings": {
            "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "MACOSX_DEPLOYMENT_TARGET": "13.0"
          },
          "link_settings": {
            "libraries": [
              "-framework Foundation",
              "-framework AppKit",
              "-framework ApplicationServices",
              "-framework CoreGraphics"
            ]
          }
        }]
      ]
    }
  ]
}
