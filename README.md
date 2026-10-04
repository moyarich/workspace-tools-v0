# @moyarich/workspace-tools

Workspace-aware release and publishing commands used by the reusable workflows in `moyarich/dev-toolkit`.

## Commands

### `discover-packages`

Discover direct-child workspace packages and emit metadata used by reusable workflows.

```sh
discover-packages [packages-directory] [--json] [--include-private] [--require-publish-config] [--require-test-script] [--require-build-script]
```

The JSON output includes each package's directory, name, version, privacy, publishability, and build/test capabilities. GitHub Actions should consume package inventory through `.github/workflows/reusable_discover-packages.yml` rather than maintaining package lists in workflow YAML.

### `workspace-release-identity`

Resolve the canonical package release identity used by draft, release, and publish workflows.

```sh
workspace-release-identity packages/auto-glow-md --version 0.1.0 --json
```

The identity contract is:

- Git tag: `<package-directory>@<version>`
- GitHub Release name: `<package-name> v<version>`

For example, `@moyarich/auto-glow-md@0.1.0` resolves to tag `packages/moyarich-auto-glow-md@0.1.0` and release name `@moyarich/auto-glow-md v0.1.0`.

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

## Reusable workflows

The package is the CLI implementation behind the repository's generic npm release and publish workflows. Package-specific workflows should delegate to those generic workflows rather than duplicate their release logic.

## Build

The package owns its executable build process:

```sh
npm run build --workspace @moyarich/workspace-tools
```

Its package-local `scripts/build-bin.mjs` uses Vite directly to build the `package.json#bin` entries into `dist/bin/*.mjs`, adds the Node.js shebang, and marks each executable as runnable.

The reusable GitHub workflows do not know about a particular bundler or build plugin. They invoke package scripts such as `npm run build`; build implementation remains the package's responsibility.
