import { MDXProvider } from "@mdx-js/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

function Pre(props: ComponentPropsWithoutRef<"pre">) {
  return <pre className="mdx-code" {...props} />;
}

function Table(props: ComponentPropsWithoutRef<"table">) {
  return (
    <div className="mdx-table-scroll">
      <table {...props} />
    </div>
  );
}

export function PlaygroundMdxProvider({ children }: { children: ReactNode }) {
  return (
    <MDXProvider components={{ pre: Pre, table: Table }}>
      {children}
    </MDXProvider>
  );
}
