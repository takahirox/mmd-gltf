# mmd-gltf

## Repository structure

- `extensions/`: runtime-independent MMD glTF extension proposals and future
  schemas, starting with `MMD_materials_toon/` and `MMD_materials_outline/`.
- `packages/`: future runtime integrations, such as Three.js loader/exporter plugins.
- `tools/`: future PMD/PMX/VMD/VPD conversion utilities.
- `examples/`: future demonstration assets and code.
- `tests/`: future validation and conformance tests.

The [MMD_materials_toon v0.1 draft](extensions/MMD_materials_toon/README.md)
includes a material specification, JSON Schema, examples, and synthetic conformance
fixtures. The other directories currently contain empty `.gitkeep` placeholders.

## Contributing

- [Development flow and English collaboration convention](docs/development-flow.md)
- [Review and merge guidelines](docs/review-guidelines.md)
- [Issue template](.github/ISSUE_TEMPLATE/issue.md)
- [Pull request template](.github/pull_request_template.md)

AI agents should start with [AGENTS.md](AGENTS.md).
