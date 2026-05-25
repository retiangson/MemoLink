export function buildGoogleCalendarUrl(
  title: string,
  description: string | null,
  due_date: string | null,
  due_time: string | null,
): string {
  const params: string[] = [`text=${encodeURIComponent(title)}`];
  if (description) params.push(`details=${encodeURIComponent(description)}`);

  if (due_date) {
    const [y, m, d] = due_date.split("-");
    if (due_time) {
      const [hh, mm] = due_time.split(":");
      const start = `${y}${m}${d}T${hh}${mm}00`;
      const endDate = new Date(+y, +m - 1, +d, +hh + 1, +mm);
      const end = [
        endDate.getFullYear(),
        String(endDate.getMonth() + 1).padStart(2, "0"),
        String(endDate.getDate()).padStart(2, "0"),
      ].join("") + "T" + [
        String(endDate.getHours()).padStart(2, "0"),
        String(endDate.getMinutes()).padStart(2, "0"),
        "00",
      ].join("");
      params.push(`dates=${start}/${end}`);
    } else {
      const next = new Date(+y, +m - 1, +d + 1);
      const endStr = `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, "0")}${String(next.getDate()).padStart(2, "0")}`;
      params.push(`dates=${y}${m}${d}/${endStr}`);
    }
  }

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&${params.join("&")}`;
}
