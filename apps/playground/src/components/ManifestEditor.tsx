import Editor from "@monaco-editor/react";

interface ManifestEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function ManifestEditor({ value, onChange }: ManifestEditorProps) {
  return (
    <Editor
      height="420px"
      language="json"
      path="package.json"
      value={value}
      theme="vs-dark"
      onChange={(next) => onChange(next ?? "")}
      options={{
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 14,
        lineHeight: 22,
        scrollBeyondLastLine: false,
        wordWrap: "on",
        padding: { top: 12, bottom: 12 },
      }}
    />
  );
}
