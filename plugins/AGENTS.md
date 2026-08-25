# Product Plugin Rules

Product Plugins are low-trust installable extensions.

- The only Hermit hard runtime dependency is the Core public contract.
- Cross-plugin cooperation uses Core contracts; do not import another plugin's
  values, tables, migrations, or private UI.
- Declare capabilities, data namespaces, schema/migration ownership, host and
  client faces, compatibility, integrity, and signing identity in the manifest.
- Host code requests privileged effects through Capability Broker/Runner;
  client code does not invoke Tauri/native directly.
- Do not use ambient filesystem/network/process/environment/credential/LLM
  authority. Keep runtime skills under the owning plugin manifest and runtime
  capability scope.
- Each plugin must build/test/clean-boot with Core alone and uninstall without
  breaking Core or deleting Canonical data by default.
