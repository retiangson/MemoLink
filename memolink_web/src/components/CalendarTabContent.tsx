import React, { useMemo, useState } from "react";
import type { useCalendar } from "../hooks/useCalendar";
import type { CalendarOccurrence } from "../api/calendarApi";
import { CalendarEventModal, type CalendarEventFields } from "./CalendarEventModal";
import { describeRecurrence } from "../utils/recurrence";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EVENTS_PER_DAY_STORAGE_KEY = "memolink-calendar-events-per-day";
const DEFAULT_EVENTS_PER_DAY = 3;

function readEventsPerDay(): number {
  if (typeof window === "undefined") return DEFAULT_EVENTS_PER_DAY;
  try {
    const value = Number(window.localStorage.getItem(EVENTS_PER_DAY_STORAGE_KEY));
    return Number.isInteger(value) && value >= 1 && value <= 12 ? value : DEFAULT_EVENTS_PER_DAY;
  } catch {
    return DEFAULT_EVENTS_PER_DAY;
  }
}

function toISO(d: Date): string {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

function formatTime12h(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

interface CalendarTabContentProps {
  calendar: ReturnType<typeof useCalendar>;
}

export function CalendarTabContent({ calendar }: CalendarTabContentProps) {
  const { range, setRange, events, loading, hasUnconnectedAccount, createEvent, updateEvent, deleteEvent } = calendar;
  const [view, setView] = useState<"month" | "agenda">("month");
  const [modalState, setModalState] = useState<{ event: CalendarOccurrence | null; defaultDate: string | null } | null>(null);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [eventsPerDay, setEventsPerDay] = useState(readEventsPerDay);

  function changeEventsPerDay(value: number) {
    const safeValue = Math.min(12, Math.max(1, Math.trunc(value)));
    setEventsPerDay(safeValue);
    try { window.localStorage.setItem(EVENTS_PER_DAY_STORAGE_KEY, String(safeValue)); } catch { /* local preferences are best effort */ }
  }

  const monthAnchor = range.start;
  const today = useMemo(() => new Date(), []);
  const todayISO = toISO(today);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarOccurrence[]>();
    for (const ev of events) {
      const list = map.get(ev.occurrence_date) ?? [];
      list.push(ev);
      map.set(ev.occurrence_date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.due_time ?? "").localeCompare(b.due_time ?? ""));
    }
    return map;
  }, [events]);

  const gridDays = useMemo(() => {
    const year = monthAnchor.getFullYear();
    const month = monthAnchor.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const startOffset = firstOfMonth.getDay();
    const gridStart = new Date(year, month, 1 - startOffset);
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) {
      days.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
    }
    return days;
  }, [monthAnchor]);

  function goToMonth(offset: number) {
    const year = monthAnchor.getFullYear();
    const month = monthAnchor.getMonth() + offset;
    setRange({
      start: new Date(year, month, 1),
      end: new Date(year, month + 1, 0),
    });
  }

  function goToToday() {
    const now = new Date();
    setRange({
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
    });
  }

  function openCreate(defaultDate?: string) {
    setModalState({ event: null, defaultDate: defaultDate ?? todayISO });
  }

  function openEdit(ev: CalendarOccurrence) {
    setModalState({ event: ev, defaultDate: null });
  }

  function handleCreate(fields: CalendarEventFields) {
    createEvent(fields.text, fields.description, fields.due_date, fields.due_time, {
      endTime: fields.end_time,
      allDay: fields.all_day,
      recurrenceRule: fields.recurrence_rule,
    });
  }

  function handleUpdate(id: number, fields: CalendarEventFields) {
    updateEvent(id, {
      text: fields.text,
      description: fields.description,
      due_date: fields.due_date,
      due_time: fields.due_time,
      end_time: fields.end_time,
      all_day: fields.all_day,
      recurrence_rule: fields.recurrence_rule,
      clear_recurrence: fields.clear_recurrence,
    });
  }

  const upcomingByDate = useMemo(() => {
    const sortedDates = Array.from(eventsByDate.keys()).filter((d) => d >= todayISO).sort();
    return sortedDates.map((d) => ({ date: d, items: eventsByDate.get(d)! }));
  }, [eventsByDate, todayISO]);

  return (
    <div className="flex-1 overflow-y-auto flex flex-col h-full bg-[var(--ml-bg-base)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--ml-bg-panel)] shrink-0">
        <div className="flex items-center gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-indigo-400" fill="currentColor" viewBox="0 0 16 16">
            <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z"/>
          </svg>
          <h1 className="text-sm font-semibold text-white">{MONTH_NAMES[monthAnchor.getMonth()]} {monthAnchor.getFullYear()}</h1>
          <div className="flex items-center gap-1">
            <button onClick={() => goToMonth(-1)} className="w-6 h-6 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-200 hover:bg-[var(--ml-bg-hover)] transition">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button onClick={goToToday} className="text-[11px] px-2 py-1 rounded-md text-gray-400 hover:text-gray-200 hover:bg-[var(--ml-bg-hover)] transition">
              Today
            </button>
            <button onClick={() => goToMonth(1)} className="w-6 h-6 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-200 hover:bg-[var(--ml-bg-hover)] transition">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          {loading && (
            <svg className="w-3 h-3 animate-spin text-gray-600" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
          )}
        </div>

        <div className="flex items-center gap-2">
          {view === "month" && (
            <label className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <span className="hidden sm:inline">Events/day</span>
              <select
                aria-label="Events displayed per calendar day"
                value={eventsPerDay}
                onChange={(event) => changeEventsPerDay(Number(event.target.value))}
                className="rounded-md border border-[var(--ml-bg-hover)] bg-[var(--ml-bg-base)] px-1.5 py-1 text-[11px] text-gray-300 focus:border-indigo-500 focus:outline-none"
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count}</option>)}
              </select>
            </label>
          )}
          <div className="flex items-center rounded-lg border border-[var(--ml-bg-hover)] overflow-hidden">
            <button
              onClick={() => setView("month")}
              className={`text-[11px] px-2.5 py-1.5 transition ${view === "month" ? "bg-indigo-600/20 text-indigo-300" : "text-gray-500 hover:text-gray-300"}`}
            >
              Month
            </button>
            <button
              onClick={() => setView("agenda")}
              className={`text-[11px] px-2.5 py-1.5 transition ${view === "agenda" ? "bg-indigo-600/20 text-indigo-300" : "text-gray-500 hover:text-gray-300"}`}
            >
              Agenda
            </button>
          </div>
          <button
            onClick={() => openCreate()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Event
          </button>
        </div>
      </div>

      {hasUnconnectedAccount && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-300">
          A connected email account doesn't have Calendar access yet — reconnect it in Settings to merge Google Calendar events.
        </div>
      )}

      {view === "month" ? (
        <div className="flex-1 flex flex-col overflow-auto p-3 min-h-0">
          <div className="grid grid-cols-7 shrink-0">
            {WEEKDAY_HEADERS.map((d) => (
              <div key={d} className="text-center text-[10px] font-semibold text-gray-600 uppercase tracking-wider py-1.5">{d}</div>
            ))}
          </div>
          <div
            className="grid grid-cols-7 gap-1"
            style={{ gridAutoRows: `${Math.max(90, 48 + eventsPerDay * 22)}px` }}
          >
            {gridDays.map((day) => {
              const iso = toISO(day);
              const inMonth = day.getMonth() === monthAnchor.getMonth();
              const isToday = iso === todayISO;
              const dayEvents = eventsByDate.get(iso) ?? [];
              const visible = dayEvents.slice(0, eventsPerDay);
              const overflow = dayEvents.length - visible.length;
              return (
                <div
                  key={iso}
                  onClick={() => openCreate(iso)}
                  className={`rounded-lg border p-1.5 flex flex-col gap-0.5 overflow-hidden cursor-pointer transition ${
                    inMonth ? "border-[var(--ml-bg-hover)] hover:border-indigo-500/30" : "border-[var(--ml-bg-panel)] opacity-40"
                  } ${isToday ? "bg-indigo-500/5 border-indigo-500/40" : "bg-[#1a1a24]"}`}
                >
                  <span className={`text-[11px] shrink-0 ${isToday ? "text-indigo-300 font-semibold" : inMonth ? "text-gray-400" : "text-gray-700"}`}>
                    {day.getDate()}
                  </span>
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    {visible.map((ev) => (
                      <button
                        key={`${ev.reminder_id}-${ev.occurrence_date}`}
                        onClick={(e) => { e.stopPropagation(); openEdit(ev); }}
                        title={ev.text}
                        className={`text-left text-[10px] truncate px-1.5 py-0.5 rounded transition ${
                          ev.done
                            ? "bg-[var(--ml-bg-hover)] text-gray-600 line-through"
                            : ev.source === "google"
                              ? "bg-blue-500/15 text-blue-300 hover:bg-blue-500/25"
                              : "bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25"
                        }`}
                      >
                        {ev.all_day ? "" : ev.due_time ? `${formatTime12h(ev.due_time)} ` : ""}{ev.text}
                      </button>
                    ))}
                    {overflow > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setExpandedDate(iso); }}
                        className="text-left text-[10px] text-gray-500 hover:text-indigo-300 px-1.5 transition"
                      >
                        +{overflow} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {upcomingByDate.length === 0 && (
            <p className="text-xs text-gray-600 text-center pt-8">No upcoming events.</p>
          )}
          {upcomingByDate.map(({ date, items }) => (
            <div key={date}>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                {date === todayISO ? "Today" : date}
              </p>
              <div className="space-y-1.5">
                {items.map((ev) => (
                  <button
                    key={`${ev.reminder_id}-${ev.occurrence_date}`}
                    onClick={() => openEdit(ev)}
                    className="w-full text-left flex items-start gap-2.5 p-2.5 rounded-xl border border-[var(--ml-bg-hover)] bg-[#1a1a24] hover:border-indigo-500/40 transition"
                  >
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs ${ev.done ? "line-through text-gray-600" : "text-gray-200"}`}>{ev.text}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[10px] text-gray-600">
                          {ev.all_day ? "All day" : ev.due_time ? formatTime12h(ev.due_time) : ""}
                        </span>
                        {ev.recurrence_rule && (
                          <span className="text-[10px] text-indigo-400/70">{describeRecurrence(ev.recurrence_rule)}</span>
                        )}
                        {ev.source === "google" && (
                          <span className="text-[10px] text-blue-400/70">Google</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {expandedDate && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => setExpandedDate(null)}
        >
          <div
            className="bg-[#1a1a24] border border-[var(--ml-bg-hover)] rounded-2xl w-full max-w-sm shadow-2xl flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--ml-bg-hover)] shrink-0">
              <h2 className="text-sm font-semibold text-white">
                {expandedDate === todayISO ? "Today" : expandedDate}
              </h2>
              <button
                onClick={() => setExpandedDate(null)}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-200 hover:bg-[var(--ml-bg-hover)] transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-3 py-3 space-y-1.5 overflow-y-auto flex-1">
              {(eventsByDate.get(expandedDate) ?? []).map((ev) => (
                <button
                  key={`${ev.reminder_id}-${ev.occurrence_date}`}
                  onClick={() => { setExpandedDate(null); openEdit(ev); }}
                  className="w-full text-left flex items-start gap-2.5 p-2.5 rounded-xl border border-[var(--ml-bg-hover)] bg-[var(--ml-bg-surface)] hover:border-indigo-500/40 transition"
                >
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs ${ev.done ? "line-through text-gray-600" : "text-gray-200"}`}>{ev.text}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] text-gray-600">
                        {ev.all_day ? "All day" : ev.due_time ? formatTime12h(ev.due_time) : ""}
                      </span>
                      {ev.source === "google" && <span className="text-[10px] text-blue-400/70">Google</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-[var(--ml-bg-hover)] shrink-0">
              <button
                onClick={() => { const d = expandedDate; setExpandedDate(null); openCreate(d); }}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add Event
              </button>
            </div>
          </div>
        </div>
      )}

      {modalState && (
        <CalendarEventModal
          event={modalState.event}
          defaultDate={modalState.defaultDate}
          onClose={() => setModalState(null)}
          onCreate={handleCreate}
          onUpdate={handleUpdate}
          onDelete={deleteEvent}
        />
      )}
    </div>
  );
}
