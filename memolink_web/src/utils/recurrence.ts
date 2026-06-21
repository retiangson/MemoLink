export type RecurrenceFreq = "none" | "daily" | "weekly" | "monthly" | "yearly";

export const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

const WEEKDAY_LABELS: Record<WeekdayCode, string> = {
  MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun",
};

export interface RecurrenceOptions {
  freq: RecurrenceFreq;
  interval?: number;
  byDay?: WeekdayCode[];
  until?: string | null; // YYYY-MM-DD
  count?: number | null;
}

export function buildRecurrenceRule(opts: RecurrenceOptions): string | null {
  if (!opts.freq || opts.freq === "none") return null;
  const parts = [`FREQ=${opts.freq.toUpperCase()}`, `INTERVAL=${opts.interval ?? 1}`];
  if (opts.freq === "weekly" && opts.byDay && opts.byDay.length > 0) {
    parts.push(`BYDAY=${opts.byDay.join(",")}`);
  }
  if (opts.until) {
    parts.push(`UNTIL=${opts.until.replace(/-/g, "")}`);
  } else if (opts.count) {
    parts.push(`COUNT=${opts.count}`);
  }
  return parts.join(";");
}

export function parseRecurrenceRule(rule: string | null | undefined): RecurrenceOptions {
  if (!rule) return { freq: "none" };
  const fields: Record<string, string> = {};
  for (const part of rule.split(";")) {
    const [k, v] = part.split("=");
    if (k && v) fields[k] = v;
  }
  const freq = (fields.FREQ?.toLowerCase() ?? "none") as RecurrenceFreq;
  const byDay = fields.BYDAY ? (fields.BYDAY.split(",") as WeekdayCode[]) : undefined;
  let until: string | null = null;
  if (fields.UNTIL && fields.UNTIL.length === 8) {
    until = `${fields.UNTIL.slice(0, 4)}-${fields.UNTIL.slice(4, 6)}-${fields.UNTIL.slice(6, 8)}`;
  }
  return {
    freq,
    interval: fields.INTERVAL ? Number(fields.INTERVAL) : 1,
    byDay,
    until,
    count: fields.COUNT ? Number(fields.COUNT) : null,
  };
}

export function describeRecurrence(rule: string | null | undefined): string {
  const opts = parseRecurrenceRule(rule);
  if (opts.freq === "none") return "Does not repeat";

  const interval = opts.interval ?? 1;
  let base: string;
  switch (opts.freq) {
    case "daily":
      base = interval === 1 ? "Daily" : `Every ${interval} days`;
      break;
    case "weekly":
      if (opts.byDay && opts.byDay.length > 0) {
        const days = opts.byDay.map((d) => WEEKDAY_LABELS[d]).join(", ");
        base = interval === 1 ? `Weekly on ${days}` : `Every ${interval} weeks on ${days}`;
      } else {
        base = interval === 1 ? "Weekly" : `Every ${interval} weeks`;
      }
      break;
    case "monthly":
      base = interval === 1 ? "Monthly" : `Every ${interval} months`;
      break;
    case "yearly":
      base = interval === 1 ? "Yearly" : `Every ${interval} years`;
      break;
    default:
      base = "Does not repeat";
  }

  if (opts.until) {
    base += ` until ${opts.until}`;
  } else if (opts.count) {
    base += `, ${opts.count} times`;
  }
  return base;
}
