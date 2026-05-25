import { useEffect, useRef, useState } from "react";
import type { SuggestionItem } from "./useSuggestions";

export function useReminderNotifications(items: SuggestionItem[]) {
  const [permission, setPermission] = useState<NotificationPermission>(
    "Notification" in window ? Notification.permission : "denied"
  );
  const firedRef = useRef<Set<number>>(new Set());

  async function requestPermission() {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    setPermission(p);
  }

  useEffect(() => {
    if (permission !== "granted") return;

    function checkDue() {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const nowTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      for (const item of items) {
        if (item.done || firedRef.current.has(item.id)) continue;
        if (!item.due_date || !item.due_time) continue;
        if (item.due_date !== todayStr) continue;
        if (item.due_time.slice(0, 5) === nowTime) {
          firedRef.current.add(item.id);
          new Notification("⏰ MemoLink Reminder", {
            body: item.text + (item.description ? `\n${item.description}` : ""),
            icon: "/memolink-icon.png",
            tag: `reminder-${item.id}`,
          });
        }
      }
    }

    checkDue();
    const id = setInterval(checkDue, 60_000);
    return () => clearInterval(id);
  }, [items, permission]);

  return { permission, requestPermission };
}
