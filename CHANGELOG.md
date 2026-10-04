# Changelog

## 0.1.0

### Added

- Discover workspace packages and return package metadata for scripts, CLIs, and CI systems.
- Check workspace dependency relationships before release and publishing operations.
- Inspect and maintain workspace package-lock state.
- Preview or create package releases using semantic-version bumps, exact versions, or the version already stored in `package.json`.
- Resolve canonical package release identities, including package-scoped Git tags and GitHub Release names.
- Preview and publish workspace packages to GitHub Packages, npm, or both.
- Publish internal workspace dependencies in dependency order with `--with-dependencies`.
- Validate release tags before publishing and block conflicting or unsafe releases.
- Preview release and publish operations with non-mutating dry-run and JSON output.
- Reuse the same packed package artifact across selected registries and optionally retain it for inspection.
