import React, { useEffect, useState } from "react";
import type { CalendarOccurrence } from "../api/calendarApi";
import {
  WEEKDAY_CODES,
  buildRecurrenceRule,
  parseRecurrenceRule,
  type RecurrenceFreq,
  type WeekdayCode,
} from "../utils/recurrence";

const WEEKDAY_SHORT: Record<WeekdayCode, string> = {
  MO: "M", TU: "T", WE: "W", TH: "T", FR: "F", SA: "S", SU: "S",
};

export interface CalendarEventFields {
  text: string;
  description: string | null;
  due_date: string | null;
  due_time: string | null;
  end_time: string | null;
  all_day: boolean;
  recurrence_rule: string | null;
  clear_recurrence?: boolean;
}

interface CalendarEventModalProps {
  event: CalendarOccurrence | null;
  defaultDate: string | null;
  onClose: () => void;
  onCreate: (fields: CalendarEventFields) => void;
  onUpdate: (id: number, fields: CalendarEventFields) => void;
  onDelete: (id: number) => void;
}

export function CalendarEventModal({ event, defaultDate, onClose, onCreate, onUpdate, onDelete }: CalendarEventModalProps) {
  const isEdit = !!event;
  const [text, setText] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [freq, setFreq] = useState<RecurrenceFreq>("none");
  const [interval, setIntervalVal] = useState(1);
  const [byDay, setByDay] = useState<WeekdayCode[]>([]);
  const [endCondition, setEndCondition] = useState<"never" | "on" | "after">("never");
  const [until, setUntil] = useState("");
  const [count, setCount] = useState(10);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (event) {
      setText(event.text);
      setDescription(event.description ?? "");
      setDueDate(event.occurrence_date);
      setDueTime(event.due_time ?? "");
      setEndTime(event.end_time ?? "");
      setAllDay(event.all_day);
      const parsed = parseRecurrenceRule(event.recurrence_rule);
      setFreq(parsed.freq);
      setIntervalVal(parsed.interval ?? 1);
      setByDay(parsed.byDay ?? []);
      setUntil(parsed.until ?? "");
      setCount(parsed.count ?? 10);
      setEndCondition(parsed.until ? "on" : parsed.count ? "after" : "never");
    } else {
      setText("");
      setDescription("");
      setDueDate(defaultDate ?? "");
      setDueTime("");
      setEndTime("");
      setAllDay(false);
      setFreq("none");
      setIntervalVal(1);
      setByDay([]);
      setEndCondition("never");
      setUntil("");
      setCount(10);
    }
    setConfirmDelete(false);
  }, [event, defaultDate]);

  function toggleByDay(code: WeekdayCode) {
    setByDay((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }

  function buildFields(): CalendarEventFields {
    const recurrence_rule = buildRecurrenceRule({
      freq,
      interval,
      byDay: freq === "weekly" ? byDay : undefined,
      until: endCondition === "on" ? until || null : null,
      count: endCondition === "after" ? count : null,
    });
    return {
      text: text.trim(),
      description: description.trim() || null,
      due_date: dueDate || null,
      due_time: allDay ? null : (dueTime || null),
      end_time: allDay ? null : (endTime || null),
      all_day: allDay,
      recurrence_rule,
      clear_recurrence: recurrence_rule === null,
    };
  }

  function handleSave() {
    if (!text.trim() || !dueDate) return;
    const fields = buildFields();
    if (isEdit && event) {
      onUpdate(event.reminder_id, fields);
    } else {
      onCreate(fields);
    }
    onClose();
  }

  function handleDelete() {
    if (!event) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    onDelete(event.reminder_id);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-[#1a1a24] border border-[var(--ml-bg-hover)] rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--ml-bg-hover)]">
          <h2 className="text-sm font-semibold text-white">{isEdit ? "Edit Event" : "New Event"}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-200 hover:bg-[var(--ml-bg-hover)] transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
          {event?.source === "google" && (
            <div className="flex items-center gap-1.5 text-[10px] text-blue-300 bg-blue-500/10 border border-blue-500/20 px-2 py-1 rounded-lg">
              Synced with Google Calendar
            </div>
          )}

          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">Title</label>
            <input
              autoFocus
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Event title…"
              className="w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2.5 text-sm text-gray-200 outline-none focus:border-indigo-500 transition"
            />
          </div>

          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">
              Description <span className="normal-case tracking-normal text-gray-600 ml-1">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2.5 text-sm text-gray-200 outline-none focus:border-indigo-500 transition resize-none leading-relaxed"
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-indigo-500" />
            All-day
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2 text-sm text-gray-200 outline-none focus:border-indigo-500 transition [color-scheme:dark]"
              />
            </div>
            {!allDay && (
              <div>
                <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">Start Time</label>
                <input
                  type="time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                  className="w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2 text-sm text-gray-200 outline-none focus:border-indigo-500 transition [color-scheme:dark]"
                />
              </div>
            )}
          </div>

          {!allDay && (
            <div>
              <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">End Time <span className="normal-case tracking-normal text-gray-600 ml-1">(optional)</span></label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2 text-sm text-gray-200 outline-none focus:border-indigo-500 transition [color-scheme:dark]"
              />
            </div>
          )}

          {/* Repeats */}
          <div>
            <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1.5">Repeats</label>
            <select
              value={freq}
              onChange={(e) => setFreq(e.target.value as RecurrenceFreq)}
              className="w-full bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-xl px-3 py-2 text-sm text-gray-200 outline-none focus:border-indigo-500 transition [color-scheme:dark]"
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </div>

          {freq !== "none" && (
            <div className="space-y-3 pl-3 border-l border-[var(--ml-bg-hover)]">
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span>Every</span>
                <input
                  type="number"
                  min={1}
                  value={interval}
                  onChange={(e) => setIntervalVal(Math.max(1, Number(e.target.value) || 1))}
                  className="w-16 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-2 py-1 text-sm text-gray-200 outline-none focus:border-indigo-500 transition"
                />
                <span>{freq === "daily" ? "day(s)" : freq === "weekly" ? "week(s)" : freq === "monthly" ? "month(s)" : "year(s)"}</span>
              </div>

              {freq === "weekly" && (
                <div className="flex gap-1">
                  {WEEKDAY_CODES.map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleByDay(code)}
                      className={`w-7 h-7 rounded-full text-[11px] font-medium transition border ${
                        byDay.includes(code)
                          ? "bg-indigo-600 border-indigo-600 text-white"
                          : "border-[var(--ml-bg-hover)] text-gray-500 hover:border-indigo-500/40"
                      }`}
                    >
                      {WEEKDAY_SHORT[code]}
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input type="radio" checked={endCondition === "never"} onChange={() => setEndCondition("never")} className="accent-indigo-500" />
                  Never ends
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input type="radio" checked={endCondition === "on"} onChange={() => setEndCondition("on")} className="accent-indigo-500" />
                  Ends on
                  <input
                    type="date"
                    value={until}
                    disabled={endCondition !== "on"}
                    onChange={(e) => setUntil(e.target.value)}
                    className="bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-2 py-1 text-xs text-gray-200 outline-none focus:border-indigo-500 transition disabled:opacity-40 [color-scheme:dark]"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                  <input type="radio" checked={endCondition === "after"} onChange={() => setEndCondition("after")} className="accent-indigo-500" />
                  Ends after
                  <input
                    type="number"
                    min={1}
                    value={count}
                    disabled={endCondition !== "after"}
                    onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))}
                    className="w-16 bg-[var(--ml-bg-surface)] border border-[var(--ml-bg-hover)] rounded-lg px-2 py-1 text-xs text-gray-200 outline-none focus:border-indigo-500 transition disabled:opacity-40"
                  />
                  occurrences
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-[var(--ml-bg-hover)] bg-[var(--ml-bg-surface)]">
          {isEdit ? (
            <button
              onClick={handleDelete}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs transition ${
                confirmDelete ? "bg-red-600 text-white hover:bg-red-500" : "text-red-500/70 hover:text-red-400 hover:bg-red-500/10"
              }`}
            >
              {confirmDelete ? "Confirm Delete" : "Delete"}
            </button>
          ) : <div />}

          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-[var(--ml-bg-hover)] rounded-xl transition">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!text.trim() || !dueDate}
              className="px-4 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl transition"
            >
              {isEdit ? "Save Changes" : "Create Event"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
