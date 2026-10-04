# @moyarich/workspace-tools

Standalone workspace-aware CLI tools for package discovery, release preparation, versioning, publishing, dependency checks, and lockfile maintenance.

## Installation

```sh
npm install --global @moyarich/workspace-tools --registry=https://npm.pkg.github.com
```

## Commands

### `discover-packages`

Discover direct-child workspace packages and emit metadata for scripts, CLIs, and CI systems.

```sh
discover-packages [packages-directory] [--json] [--include-private] [--require-publish-config] [--require-test-script] [--require-build-script]
```

The JSON output includes each package's directory, name, version, privacy, publishability, and build/test capabilities.

### `workspace-release-identity`

Resolve the canonical package release identity used by draft, release, and publish workflows.

```sh
workspace-release-identity packages/example-package --version 0.1.0 --json
```

The identity contract is:

- Git tag: `<package-directory>@<version>`
- GitHub Release name: `<package-name> v<version>`

For example, `@example/package@0.1.0` resolves to tag `packages/moyarich-auto-glow-md@0.1.0` and release name `@example/package v0.1.0`.

### `workspace-release`

Create or preview a package release from a package under `packages/*`.

```sh
workspace-release <package>=<version> [--mode=bump|exact|package-json] [--version=<value>] [--dry-run]
```

Release modes:

- `bump` — uses an npm version bump: `patch`, `minor`, `major`, `prepatch`, `preminor`, `premajor`, or `prerelease`.
- `exact` — uses an exact SemVer.
- `package-json` — releases the version already present in the package manifest.
- `--dry-run` — previews the resolved version, registry state, and changelog without changing the repository.

### `workspace-publish`

Validate and publish a workspace package.

```sh
workspace-publish <package> [--registry=github|npm|both] [--tag=latest] [--access=public|restricted] [--artifact-directory=<dir>] [--ls] [--with-dependencies] [--dry-run]
```

Use `--ls` to print the resolved publish plan without validating or publishing. Combine `--ls --dry-run` to print that plan and then validate, test, build, and create the package tarball without publishing. Use `--with-dependencies` to include internal workspace dependencies first in dependency order.

`workspace-publish` now packs each package exactly once and promotes that same `.tgz` to every selected registry. Use `--artifact-directory=<dir>` to keep the generated tarball; otherwise a temporary directory is used and cleaned after the operation. GitHub Packages receives the tarball with `npm publish <tarball>`, while npm staged publishing receives the same tarball with `npm stage publish <tarball>`.

GitHub Packages uses `_GITHUB_TOKEN`. npm publishing uses `_NPM_TOKEN`.

## Development

Development and testing documentation lives under [docs/04-development](./docs/04-development/page.mdx).

The publishable package is `packages/workspace-tools`; `apps/playground` renders the repository's MDX documentation and examples for local development and GitHub Pages.

## Examples

Executable CLI examples live under `docs/examples/*`, alongside their MDX pages and captured terminal output.

```sh
npm run docs:cli
npm run docs:cli:capture
```

The playground discovers and renders `docs/**/page.mdx`; documentation content stays outside the app.
