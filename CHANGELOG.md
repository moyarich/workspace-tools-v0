# Changelog

## 0.1.0

### Added

- Discover workspace packages and return package metadata for scripts and CI automation.
- Check workspace dependency relationships before release and publishing operations.
- Inspect and maintain workspace package-lock state.
- Preview or create package releases with semantic-version bumps, exact versions, or the version already stored in `package.json`.
- Resolve canonical package release identities, including package-scoped Git tags and GitHub Release names.
- Preview and publish workspace packages to GitHub Packages, npm, or both.
- Publish internal workspace dependencies in dependency order with `--with-dependencies`.
- Validate release tags before publishing and refuse conflicting or unsafe releases.
- Preview release and publish operations with non-mutating dry-run and JSON output.
- Reuse the exact packed tarball across selected registries and optionally retain it as an artifact.
