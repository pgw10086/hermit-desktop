# Native Provider Rules

- Native and FFI code is a Core-owned provider surface, not Product Plugin
  ambient authority.
- Validate every cross-process/ABI input and preserve protocol generation,
  timeout, cancellation, and error semantics.
- Route privileged operations through declared capabilities. Product Plugins
  do not link native APIs directly.
- Keep `unsafe` blocks minimal, documented, and wrapped by safe interfaces.
- Put platform-specific Swift/Win32/Linux code inside its owning Rust crate,
  not new top-level platform directories.
- Denial paths and process/resource cleanup require tests.
