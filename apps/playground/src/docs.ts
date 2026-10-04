import type { ComponentType } from "react";

export interface PlaygroundDoc {
  id: string;
  label: string;
  Component: ComponentType;
}

type MdxModule = {
  default: ComponentType;
};

const modules = import.meta.glob<MdxModule>("../../../docs/**/page.mdx", {
  eager: true,
});

function labelFromId(id: string) {
  if (id === "overview") return "Overview";

  const raw = id.split("/").at(-1) ?? id;
  return raw
    .replace(/^\d+-/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export const docs: PlaygroundDoc[] = Object.entries(modules)
  .map(([file, module]) => {
    const relative = file
      .replace("../../../docs/", "")
      .replace(/\/page\.mdx$/, "");

    const id = relative || "overview";

    return {
      id,
      label: labelFromId(id),
      Component: module.default,
    };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

export function docPath(id: string) {
  return id === "overview" ? "/" : "/docs/" + id;
}
