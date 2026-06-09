export const SLASH_COMMANDS = [
  { cmd: "Improve",    syntax: '/Improve "Note Name"',               desc: "Improve grammar & formatting",  hasAll: true },
  { cmd: "Enhance",    syntax: '/Enhance "Note Name"',               desc: "Expand and enrich",             hasAll: true },
  { cmd: "Summarize",  syntax: '/Summarize "Note Name"',             desc: "Create a summary note",         hasAll: true },
  { cmd: "Natural",    syntax: '/Natural "Note Name"',               desc: "Rewrite naturally" },
  { cmd: "Humanize",   syntax: '/Humanize "Note Name"',              desc: "Natural writing style" },
  { cmd: "Update",     syntax: '/Update "Note Name" : instruction',  desc: "Merge instruction into note" },
  { cmd: "Add",        syntax: '/Add "Note Name" : content',         desc: "Append content to note" },
  { cmd: "Undo",       syntax: '/Undo "Note Name"',                  desc: "Restore previous version" },
  { cmd: "Reminder",   syntax: '/Reminder title : YYYY-MM-DD HH:MM', desc: "Create a reminder" },
  { cmd: "Quiz",       syntax: '/Quiz "Note Name" : 10',             desc: "Generate interactive quiz",     hasAll: true },
  { cmd: "Discussion", syntax: '/Discussion "Note Name" your question', desc: "Multi-model discussion",     hasAll: true },
  { cmd: "Write",      syntax: "/Write your writing prompt",         desc: "Multi-model writing + synthesis" },
  { cmd: "Read",       syntax: '/Read "Note Name"',                  desc: "Read note in chat" },
  { cmd: "Feedback",   syntax: '/Feedback title : message',          desc: "Submit a suggestion" },
  { cmd: "ReportBug",  syntax: '/ReportBug title : description',     desc: "Report a bug" },
] as const;

export function buildDiscussionCommand(prompt: string) {
  const trimmed = prompt.trim();
  return trimmed ? `/Discussion ${trimmed}` : "/Discussion";
}
