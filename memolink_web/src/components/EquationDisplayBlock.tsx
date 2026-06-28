import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import katex from "katex";
import "katex/dist/katex.min.css";

function EquationDisplayView({ node, selected }: NodeViewProps) {
  const latex = String(node.attrs.latex || "");
  const label = String(node.attrs.label || "Formula");
  const rendered = katex.renderToString(latex, { displayMode: true, throwOnError: false, strict: "ignore" });
  return (
    <NodeViewWrapper className={`equation-display-block ${selected ? "equation-display-block-selected" : ""}`} contentEditable={false}>
      <span className="equation-display-label">{label}</span>
      <div className="equation-display-formula" dangerouslySetInnerHTML={{ __html: rendered }} />
    </NodeViewWrapper>
  );
}

export const EquationDisplayBlock = Node.create({
  name: "equationDisplay",
  group: "block",
  atom: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-memolink-equation-latex") || element.textContent || "",
        renderHTML: (attributes: { latex?: string }) => ({ "data-memolink-equation-latex": attributes.latex || "" }),
      },
      label: {
        default: "Formula",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-equation-label") || "Formula",
        renderHTML: (attributes: { label?: string }) => ({ "data-equation-label": attributes.label || "Formula" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-memolink-equation-latex]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "equation-display-block" }), node.attrs.latex];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EquationDisplayView);
  },
});
