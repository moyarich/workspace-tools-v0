import { useMemo, useState } from "react";

import { ManifestEditor } from "./ManifestEditor";

const DEFAULT_MANIFEST = JSON.stringify(
  {
    name: "@example/workspace",
    private: true,
    workspaces: ["packages/*", "apps/*"],
    scripts: {
      build: "npm run build --workspaces --if-present",
      test: "npm test --workspaces --if-present",
    },
  },
  null,
  2,
);

const COMMANDS = [
  "discover-packages packages --json",
  "workspace-dependency-check --json",
  "workspace-package-lock --json",
  "workspace-release --dry-run",
  "workspace-publish --dry-run",
].join("\n");

export function WorkspacePlayground() {
  const [manifest, setManifest] = useState(DEFAULT_MANIFEST);

  const parsed = useMemo(() => {
    try {
      return { value: JSON.parse(manifest), error: null };
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [manifest]);

  const workspacePattern = Array.isArray(parsed.value?.workspaces)
    ? parsed.value.workspaces.join(", ")
    : "packages/*";

  return (
    <section className="workspace-playground">
      <header>
        <span className="eyebrow">Monaco workspace editor</span>
        <h2>Try a workspace manifest</h2>
      </header>

      <div className="workspace-playground-grid">
        <div className="editor-shell">
          <ManifestEditor value={manifest} onChange={setManifest} />
        </div>

        <aside className="command-preview">
          <h3>CLI preview</h3>
          {parsed.error ? (
            <p className="error">{parsed.error}</p>
          ) : (
            <>
              <p>
                Workspace patterns: <code>{workspacePattern}</code>
              </p>
              <pre>
                <code>{COMMANDS}</code>
              </pre>
              <p className="muted">
                The browser playground previews commands. Executable examples
                and captured terminal output live under docs/examples.
              </p>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
