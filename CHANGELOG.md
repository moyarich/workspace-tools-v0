# Changelog

## 0.1.0

### Added

- Workspace package discovery with reusable metadata for GitHub Actions.
- `workspace-release` with bump, exact-version, package-json, dry-run, JSON, and interactive selection modes.
- `workspace-release-identity` for canonical package-directory Git tags and GitHub Release names shared by drafting, releasing, and publishing.
- `workspace-publish` with registry selection, dependency ordering, dry-run plans, JSON output, and interactive confirmation.
- Dependency checks and safe workspace-selector validation before release or publish operations.
- Registry-state checks that distinguish unpublished packages from registry failures.
- Git-tag verification and conflict guardrails for releases and publishing.
- Release identity metadata in release and publish JSON for workflow orchestration.
- Package-scoped changelog generation from commit history.
- `workspace-package-lock` and reusable package-discovery CLIs.
- Package-local release, publish, and CLI documentation.

### Changed

- Standardize the package on Node 24, TypeScript, Commander, Vitest, and Vite-built CLI entry points.
- Build executables into `dist/bin` and use `dist/` as the package runtime boundary.
- Pack each workspace package once and publish the exact generated tarball to selected registries.
- Support retaining packed tarballs as local artifacts and GitHub Actions artifacts.

### Fixed

- Keep release dry runs non-mutating and produce clean human and JSON output.
- Resolve previous package releases and unpublished-package versions reliably.
- Reject unsafe package selectors and prevent publishing private workspaces.
- Preserve required subprocess diagnostics without polluting JSON results.
- Report existing tag conflicts without moving tags.
