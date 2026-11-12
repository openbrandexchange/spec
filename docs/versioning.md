# Versioning

- The specification uses **Semantic Versioning**: `MAJOR.MINOR.PATCH` with pre-release tags (`0.3.0-rc.1`). The current version is in [`CHANGELOG.md`](../CHANGELOG.md), the OpenAPI `info.version` fields and every schema's `$id` path (`/schemas/v0.3/`). Only the current version is maintained on `main`; the schemas of earlier releases are in their git tags (`v0.1.0`, `v0.2.0`).
- The **URL prefix** carries the major version: `/obx/v1`. Discovery advertises `obx_version` (`major.minor`) and `spec_version` (exact).
- **Minor** releases are additive: new optional fields, new endpoints, new capabilities, new enum values, new change types, new error codes. Clients written for an older minor keep working because they MUST ignore what they do not know ([protocol.md §2](protocol.md#2-conventions)).
- **Major** releases may break conforming clients (removing or renaming fields, changing semantics). A node SHOULD serve the previous major (`/obx/v1` next to `/obx/v2`) for at least 12 months after a new major is released.
- **Patch** releases fix wording, examples and schemas that contradicted the prose; they never change behaviour on purpose.
- Before 1.0, minor versions MAY contain breaking changes; each is listed under "Breaking" in the changelog with a migration note. The goal is to freeze 1.0 after feedback from at least one external brand and one external consumer.
- **Extensions** use `x-<vendor>-` field names and never collide with future standard fields. Popular extensions are candidates for standardisation in a minor release.
- The Node Admin + Portal API (`node-admin.yaml`) is versioned together with the reference nodes and the shared admin UI, not with the protocol; it may change in any minor release.
