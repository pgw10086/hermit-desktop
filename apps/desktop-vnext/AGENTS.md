# Desktop Assembly Rules

This subtree is the only mixed desktop assembly.

- Use the pinned DSH Web shell and the shared platform React/ReactDOM identity.
- Consume DSH only through approved adapters and public slots/contracts.
- Keep Product Plugin UI out of direct Tauri/native calls; route privileged
  intent through Core-owned IPC and Capability Broker contracts.
- Keep the Tauri executable thin: window/process/rescue/native-provider
  assembly belongs here, business behavior stays with its owner.
- Verify WebView startup, shutdown, cancellation, crash generation, keyboard,
  IME, drag/drop, overlay, and theme behavior on each supported platform.
