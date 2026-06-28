import React from "react";
import type { SourceTimelineEvent } from "../../api/smartSourceApi";

export function NoteTimelineTab({ events }: { events: SourceTimelineEvent[] }) {
  if (!events.length) return <div className="p-6 text-sm text-gray-500">No source-workspace events yet.</div>;
  return (
    <ol className="p-5">
      {events.map((event) => (
        <li key={event.id} className="relative border-l border-indigo-500/30 pb-5 pl-5 last:pb-0">
          <span className="absolute -left-1.5 top-0.5 h-3 w-3 rounded-full bg-indigo-500" />
          <p className="text-sm text-gray-300">{event.event_summary}</p>
          <p className="mt-1 text-[11px] uppercase tracking-wide text-gray-600">{event.event_type} · {event.created_at ? new Date(event.created_at).toLocaleString() : "just now"}</p>
        </li>
      ))}
    </ol>
  );
}
