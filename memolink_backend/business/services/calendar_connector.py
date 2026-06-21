from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

import httpx

from memolink_backend.business.services.gmail_connector import GmailConnector

CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar"

# Shared, process-lifetime client — same pooling rationale as gmail_connector's.
_async_client: httpx.AsyncClient | None = None


def _get_async_client() -> httpx.AsyncClient:
    global _async_client
    if _async_client is None or _async_client.is_closed:
        _async_client = httpx.AsyncClient(
            limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
            timeout=30.0,
        )
    return _async_client


def has_calendar_scope(granted_scope: Optional[str]) -> bool:
    return bool(granted_scope) and CALENDAR_SCOPE in granted_scope.split()


class CalendarConnector:
    def __init__(self, gmail: GmailConnector):
        self.gmail = gmail

    async def list_events(
        self,
        user_id: int,
        *,
        time_min: datetime,
        time_max: datetime,
        email_account_id: int | None = None,
    ) -> list[dict]:
        access_token = await self.gmail.get_valid_access_token(user_id, email_account_id)
        client = _get_async_client()
        resp = await client.get(
            CALENDAR_API,
            headers={"Authorization": f"Bearer {access_token}"},
            params={
                "timeMin": time_min.isoformat(),
                "timeMax": time_max.isoformat(),
                "singleEvents": "false",
                "maxResults": 250,
            },
        )
        if resp.status_code != 200:
            raise ValueError(f"Google Calendar API error: {resp.status_code} {resp.text[:200]}")
        return resp.json().get("items", [])

    async def create_event(self, user_id: int, event: dict, *, email_account_id: int | None = None) -> dict:
        access_token = await self.gmail.get_valid_access_token(user_id, email_account_id)
        client = _get_async_client()
        resp = await client.post(
            CALENDAR_API,
            headers={"Authorization": f"Bearer {access_token}"},
            json=event,
        )
        if resp.status_code not in (200, 201):
            raise ValueError(f"Google Calendar create failed: {resp.status_code} {resp.text[:200]}")
        return resp.json()

    async def update_event(
        self, user_id: int, google_event_id: str, event: dict, *, email_account_id: int | None = None
    ) -> dict:
        access_token = await self.gmail.get_valid_access_token(user_id, email_account_id)
        client = _get_async_client()
        resp = await client.put(
            f"{CALENDAR_API}/{google_event_id}",
            headers={"Authorization": f"Bearer {access_token}"},
            json=event,
        )
        if resp.status_code != 200:
            raise ValueError(f"Google Calendar update failed: {resp.status_code} {resp.text[:200]}")
        return resp.json()

    async def delete_event(self, user_id: int, google_event_id: str, *, email_account_id: int | None = None) -> None:
        access_token = await self.gmail.get_valid_access_token(user_id, email_account_id)
        client = _get_async_client()
        resp = await client.delete(
            f"{CALENDAR_API}/{google_event_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        # 410 Gone means it was already deleted on Google's side — treat as success.
        if resp.status_code not in (200, 204, 404, 410):
            raise ValueError(f"Google Calendar delete failed: {resp.status_code} {resp.text[:200]}")


def reminder_to_google_event(
    *,
    text: str,
    description: Optional[str],
    due_date: Optional[str],
    due_time: Optional[str],
    end_time: Optional[str],
    all_day: bool,
    recurrence_rule: Optional[str],
) -> dict:
    event: dict = {"summary": text, "description": description or ""}
    if not due_date:
        raise ValueError("due_date is required to sync an event to Google Calendar")

    if all_day or not due_time:
        event["start"] = {"date": due_date}
        event["end"] = {"date": due_date}
    else:
        start_dt = f"{due_date}T{due_time}:00Z"
        end_dt = f"{due_date}T{end_time}:00Z" if end_time else start_dt
        event["start"] = {"dateTime": start_dt, "timeZone": "UTC"}
        event["end"] = {"dateTime": end_dt, "timeZone": "UTC"}

    if recurrence_rule:
        event["recurrence"] = [f"RRULE:{recurrence_rule}"]
    return event


def google_event_to_reminder_fields(event: dict) -> dict:
    summary = event.get("summary") or "(No title)"
    description = event.get("description") or None
    start = event.get("start") or {}
    end = event.get("end") or {}

    all_day = "date" in start
    if all_day:
        due_date = start.get("date")
        due_time = None
        end_time = None
    else:
        start_dt = start.get("dateTime") or ""
        end_dt = end.get("dateTime") or ""
        due_date = start_dt[:10] or None
        due_time = start_dt[11:16] or None
        end_time = end_dt[11:16] or None

    recurrence_rule = None
    recurrence = event.get("recurrence") or []
    for r in recurrence:
        if r.upper().startswith("RRULE:"):
            recurrence_rule = r[len("RRULE:"):]
            break

    return {
        "text": summary,
        "description": description,
        "due_date": due_date,
        "due_time": due_time,
        "end_time": end_time,
        "all_day": all_day,
        "recurrence_rule": recurrence_rule,
        "google_event_id": event.get("id"),
        "google_calendar_id": "primary",
    }
