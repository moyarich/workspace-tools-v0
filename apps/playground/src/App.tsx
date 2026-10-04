import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";

import { WorkspacePlayground } from "./components/WorkspacePlayground";
import { docs, docPath } from "./docs";
import { PlaygroundMdxProvider } from "./mdx/PlaygroundMdxProvider";

function DocsSidebar() {
  const location = useLocation();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <strong>@moyarich/workspace-tools</strong>
        <span>CLI docs + playground</span>
      </div>

      <nav aria-label="Documentation">
        {docs.map((doc) => {
          const href = docPath(doc.id);
          const active = location.pathname === href;

          return (
            <Link key={doc.id} to={href} aria-current={active ? "page" : undefined}>
              {doc.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

function DocPage({ id }: { id: string }) {
  const doc = docs.find((item) => item.id === id);

  if (!doc) {
    return <Navigate to="/" replace />;
  }

  const Page = doc.Component;

  return (
    <article className="doc-page">
      <PlaygroundMdxProvider>
        <Page />
      </PlaygroundMdxProvider>
    </article>
  );
}

function Home() {
  const overview = docs.find((item) => item.id === "overview");

  return (
    <>
      {overview ? <DocPage id="overview" /> : null}
      <WorkspacePlayground />
    </>
  );
}

export function App() {
  return (
    <div className="app-shell">
      <DocsSidebar />

      <main className="main-content">
        <Routes>
          <Route path="/" element={<Home />} />
          {docs
            .filter((doc) => doc.id !== "overview")
            .map((doc) => (
              <Route
                key={doc.id}
                path={docPath(doc.id)}
                element={<DocPage id={doc.id} />}
              />
            ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
