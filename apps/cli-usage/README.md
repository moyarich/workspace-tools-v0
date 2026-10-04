# CLI usage app

This app is an executable documentation fixture for `@moyarich/workspace-tools`.

It uses tracked package manifests under `fixture/packages/*` and invokes the real built binaries from `dist/bin`.

Run from the repository root:

```sh
npm run example:cli
```

Refresh committed terminal snapshots:

```sh
npm run example:cli:capture
```

The generated files under `output/` are documentation artifacts, not mocked command responses.
