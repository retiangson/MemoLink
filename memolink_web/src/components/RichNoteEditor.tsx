import React, { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Color from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import { marked } from "marked";
import "../styles/editor.css";

interface RichNoteEditorProps {
  value: string;          // HTML (or legacy Markdown — auto-detected)
  onChange: (html: string) => void;
  noteKey: string | number;  // changes when a different note is opened
  disabled?: boolean;
}

function isHtml(s: string) {
  return /^\s*</.test(s);
}

function looksLikeMarkdown(s: string) {
  return /(^|\n)\s{0,3}#{1,6}\s+\S/.test(s) ||
    /(^|\n)\s{0,3}[-*]\s+\S/.test(s) ||
    /(^|\n)\s{0,3}\d+\.\s+\S/.test(s) ||
    /(\*\*|__)[^*_]+(\*\*|__)/.test(s) ||
    /(^|\n)\s{0,3}>\s+\S/.test(s);
}

function unwrapMarkdownFence(s: string) {
  const match = s.trim().match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return match ? match[1].trim() : s;
}

function hasRichHtmlStructure(s: string) {
  return /<(h[1-6]|ul|ol|li|strong|em|blockquote|pre|code|table|thead|tbody|tr|th|td)\b/i.test(s);
}

async function toHtml(content: string): Promise<string> {
  if (!content.trim()) return "";
  const unwrapped = unwrapMarkdownFence(content);
  if (unwrapped !== content) return (await marked(unwrapped)) as string;
  if (isHtml(content)) {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const code = doc.body.querySelector("pre > code");
    if (code && code.textContent && looksLikeMarkdown(code.textContent)) {
      return (await marked(unwrapMarkdownFence(code.textContent))) as string;
    }
    if (hasRichHtmlStructure(content)) return content;
    const text = doc.body.textContent ?? "";
    if (looksLikeMarkdown(text)) return (await marked(text)) as string;
    return content;
  }
  return (await marked(content)) as string;
}

// ── Toolbar icon buttons ──────────────────────────────────────────────────
function Btn({
  active, disabled, onClick, title, children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      disabled={disabled}
      title={title}
      className={`flex items-center justify-center w-7 h-6 rounded text-[13px] transition select-none
        ${active
          ? "bg-indigo-700/60 text-indigo-200"
          : "text-gray-400 hover:bg-[#2a2a3a] hover:text-gray-100"}
        disabled:opacity-30 disabled:pointer-events-none`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-4 bg-[#2a2a3a] mx-0.5 shrink-0" />;
}

export function RichNoteEditor({ value, onChange, noteKey, disabled }: RichNoteEditorProps) {
  const lastSent = useRef<string>("");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Underline,
      Highlight.configure({ multicolor: false }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "tiptap-link" } }),
      Placeholder.configure({ placeholder: "Start writing…" }),
      TextStyle,
      Color,
    ],
    editorProps: {
      attributes: { class: "tiptap-content" },
    },
    onUpdate({ editor }) {
      const html = editor.getHTML();
      lastSent.current = html;
      onChange(html);
    },
  });

  // Reinitialise when noteKey changes (switching notes)
  useEffect(() => {
    if (!editor) return;
    toHtml(value).then((html) => {
      lastSent.current = "__reinit__";
      editor.commands.setContent(html || "");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteKey, editor]);

  // Sync external updates (recording, AI apply) without disturbing user typing
  useEffect(() => {
    if (!editor) return;
    if (value !== lastSent.current) {
      toHtml(value).then((html) => {
        lastSent.current = "__sync__";
        editor.commands.setContent(html || "");
        editor.commands.focus("end");
      });
    }
  }, [value, editor]);

  // Link insertion helper
  function setLink() {
    const prev = editor?.getAttributes("link").href ?? "";
    const url = window.prompt("URL:", prev);
    if (url === null) return;
    if (url === "") { editor?.chain().focus().unsetLink().run(); return; }
    editor?.chain().focus().setLink({ href: url }).run();
  }

  if (!editor) return null;

  const e = editor;

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 flex-wrap px-1 py-1.5 border-b border-[#1e1e2a] shrink-0 bg-[#0d0d12]">

        {/* History */}
        <Btn title="Undo" onClick={() => e.chain().focus().undo().run()} disabled={!e.can().undo()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466"/></svg>
        </Btn>
        <Btn title="Redo" onClick={() => e.chain().focus().redo().run()} disabled={!e.can().redo()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/></svg>
        </Btn>

        <Divider />

        {/* Block type */}
        <Btn title="Paragraph" active={e.isActive("paragraph")} onClick={() => e.chain().focus().setParagraph().run()}>¶</Btn>
        <Btn title="Heading 1" active={e.isActive("heading", { level: 1 })} onClick={() => e.chain().focus().toggleHeading({ level: 1 }).run()}>H1</Btn>
        <Btn title="Heading 2" active={e.isActive("heading", { level: 2 })} onClick={() => e.chain().focus().toggleHeading({ level: 2 }).run()}>H2</Btn>
        <Btn title="Heading 3" active={e.isActive("heading", { level: 3 })} onClick={() => e.chain().focus().toggleHeading({ level: 3 }).run()}>H3</Btn>

        <Divider />

        {/* Inline styles */}
        <Btn title="Bold (Ctrl+B)" active={e.isActive("bold")} onClick={() => e.chain().focus().toggleBold().run()}>
          <b>B</b>
        </Btn>
        <Btn title="Italic (Ctrl+I)" active={e.isActive("italic")} onClick={() => e.chain().focus().toggleItalic().run()}>
          <i>I</i>
        </Btn>
        <Btn title="Underline (Ctrl+U)" active={e.isActive("underline")} onClick={() => e.chain().focus().toggleUnderline().run()}>
          <u>U</u>
        </Btn>
        <Btn title="Strikethrough" active={e.isActive("strike")} onClick={() => e.chain().focus().toggleStrike().run()}>
          <s>S</s>
        </Btn>
        <Btn title="Inline code" active={e.isActive("code")} onClick={() => e.chain().focus().toggleCode().run()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M5.854 4.854a.5.5 0 1 0-.708-.708l-3.5 3.5a.5.5 0 0 0 0 .708l3.5 3.5a.5.5 0 0 0 .708-.708L2.707 8zm4.292 0a.5.5 0 0 1 .708-.708l3.5 3.5a.5.5 0 0 1 0 .708l-3.5 3.5a.5.5 0 0 1-.708-.708L13.293 8z"/></svg>
        </Btn>
        <Btn title="Highlight" active={e.isActive("highlight")} onClick={() => e.chain().focus().toggleHighlight().run()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M1 0 0 1l2.2 3.081a1 1 0 0 0 .815.419h.07a1 1 0 0 1 .708.293l2.675 2.675-2.617 2.654A3.003 3.003 0 0 0 0 13a3 3 0 1 0 5.878-.851l2.654-2.617.968.968-.305.914a1 1 0 0 0 .242 1.023l3.27 3.27a.5.5 0 0 0 .707 0l2.3-2.3a.5.5 0 0 0 0-.707l-3.27-3.27a1 1 0 0 0-1.023-.242L10.5 9.5l-.96-.96 2.68-2.643A3.005 3.005 0 0 0 16 3q0-.405-.102-.777l-2.14 2.141L12 4l-.364-1.757L13.777.102a3 3 0 0 0-3.675 3.68L7.462 6.46 4.793 3.793a1 1 0 0 1-.293-.707v-.071a1 1 0 0 0-.419-.814zm9.646 10.646a.5.5 0 0 1 .708 0l2.914 2.915-1.414 1.414-2.915-2.914a.5.5 0 0 1 0-.707z"/></svg>
        </Btn>

        <Divider />

        {/* Lists */}
        <Btn title="Bullet list" active={e.isActive("bulletList")} onClick={() => e.chain().focus().toggleBulletList().run()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m-3 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2m0 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2m0 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2"/></svg>
        </Btn>
        <Btn title="Numbered list" active={e.isActive("orderedList")} onClick={() => e.chain().focus().toggleOrderedList().run()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M5 11.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5"/><path d="M1.713 11.865v-.474H2c.217 0 .363-.137.363-.317 0-.185-.158-.31-.361-.31-.223 0-.367.152-.373.31h-.59c.016-.467.373-.787.986-.787.588 0 .954.291.954.703a.595.595 0 0 1-.492.594v.033a.615.615 0 0 1 .569.631c0 .453-.422.745-1.018.745-.629 0-1-.315-1.011-.76h.592a.39.39 0 0 0 .416.35c.238 0 .395-.145.395-.35-.002-.195-.162-.337-.4-.337h-.3zm-.004-4.699h-.604v-.035c0-.408.295-.844.958-.844.583 0 .96.326.96.756 0 .389-.257.617-.476.848l-.537.572v.03h1.054V9H1.143v-.395l.957-.99c.138-.142.293-.304.293-.508 0-.18-.147-.32-.342-.32a.33.33 0 0 0-.342.338zM2.564 5h-.635V2.924h-.031l-.598.42v-.567l.629-.443h.635z"/></svg>
        </Btn>
        <Btn title="Task list" active={e.isActive("taskList")} onClick={() => e.chain().focus().toggleTaskList().run()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z"/><path d="m10.97 4.97-.02.022-3.473 4.425-2.093-2.094a.75.75 0 0 0-1.06 1.06L6.97 11.03a.75.75 0 0 0 1.079-.02l3.992-4.99a.75.75 0 0 0-1.071-1.05"/></svg>
        </Btn>

        <Divider />

        {/* Block elements */}
        <Btn title="Blockquote" active={e.isActive("blockquote")} onClick={() => e.chain().focus().toggleBlockquote().run()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M12 12a1 1 0 0 0 1-1V8.558a1 1 0 0 0-1-1h-1.388c0-.351.021-.703.062-1.054.062-.372.166-.703.31-.992.145-.29.331-.517.559-.683.227-.186.516-.279.868-.279V3c-.579 0-1.085.124-1.52.372a3.322 3.322 0 0 0-1.085.992 4.92 4.92 0 0 0-.62 1.458A7.712 7.712 0 0 0 9 7.558V11a1 1 0 0 0 1 1zm-6 0a1 1 0 0 0 1-1V8.558a1 1 0 0 0-1-1H4.612c0-.351.021-.703.062-1.054.062-.372.166-.703.31-.992.145-.29.331-.517.559-.683.227-.186.516-.279.868-.279V3c-.579 0-1.085.124-1.52.372a3.322 3.322 0 0 0-1.085.992 4.92 4.92 0 0 0-.62 1.458A7.712 7.712 0 0 0 3 7.558V11a1 1 0 0 0 1 1z"/></svg>
        </Btn>
        <Btn title="Code block" active={e.isActive("codeBlock")} onClick={() => e.chain().focus().toggleCodeBlock().run()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z"/><path d="M6.854 4.646a.5.5 0 0 1 0 .708L4.207 8l2.647 2.646a.5.5 0 0 1-.708.708l-3-3a.5.5 0 0 1 0-.708l3-3a.5.5 0 0 1 .708 0zm2.292 0a.5.5 0 0 0 0 .708L11.793 8l-2.647 2.646a.5.5 0 0 0 .708.708l3-3a.5.5 0 0 0 0-.708l-3-3a.5.5 0 0 0-.708 0z"/></svg>
        </Btn>
        <Btn title="Divider" onClick={() => e.chain().focus().setHorizontalRule().run()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M0 8a.5.5 0 0 1 .5-.5h15a.5.5 0 0 1 0 1H.5A.5.5 0 0 1 0 8"/></svg>
        </Btn>

        <Divider />

        {/* Alignment */}
        <Btn title="Align left" active={e.isActive({ textAlign: "left" })} onClick={() => e.chain().focus().setTextAlign("left").run()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M2 12.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5m0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5m0-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5m0-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5"/></svg>
        </Btn>
        <Btn title="Align center" active={e.isActive({ textAlign: "center" })} onClick={() => e.chain().focus().setTextAlign("center").run()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M4 12.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5m-2-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5m2-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5m-2-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5"/></svg>
        </Btn>
        <Btn title="Align right" active={e.isActive({ textAlign: "right" })} onClick={() => e.chain().focus().setTextAlign("right").run()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path fillRule="evenodd" d="M6 12.5a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5m-4-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5m4-3a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5m-4-3a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11a.5.5 0 0 1-.5-.5"/></svg>
        </Btn>

        <Divider />

        {/* Link + clear */}
        <Btn title="Link" active={e.isActive("link")} onClick={setLink}>
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1 1 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4 4 0 0 1-.128-1.287z"/><path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243z"/></svg>
        </Btn>
        <Btn title="Clear formatting" onClick={() => e.chain().focus().unsetAllMarks().clearNodes().run()}>
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M8.086 2.207a2 2 0 0 1 2.828 0l3.879 3.879a2 2 0 0 1 0 2.828l-5.5 5.5A2 2 0 0 1 7.879 15H5.12a2 2 0 0 1-1.414-.586l-2.5-2.5a2 2 0 0 1 0-2.828zm.66 11.34L3.453 8.254 1.914 9.793a1 1 0 0 0 0 1.414l2.5 2.5a1 1 0 0 0 .707.293H7.88a1 1 0 0 0 .707-.293z"/></svg>
        </Btn>
      </div>

      {/* ── Editor area ─────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-2 py-3 cursor-text" onClick={() => e.commands.focus()}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
