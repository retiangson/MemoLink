from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Optional

from memolink_backend.business.services.calendar_connector import (
    CalendarConnector,
    google_event_to_reminder_fields,
    has_calendar_scope,
    reminder_to_google_event,
)
from memolink_backend.business.services.recurrence_service import expand_occurrences
from memolink_backend.domain.models.reminder import Reminder
from memolink_backend.domain.repositories.email_account_repository import EmailAccountRepository
from memolink_backend.domain.repositories.reminder_repository import ReminderRepository

logger = logging.getLogger(__name__)


class CalendarService:
    def __init__(
        self,
        reminder_repo: ReminderRepository,
        account_repo: EmailAccountRepository,
        calendar_connector: CalendarConnector,
    ):
        self.reminder_repo = reminder_repo
        self.account_repo = account_repo
        self.calendar_connector = calendar_connector

    def get_status(self, user_id: int) -> dict:
        accounts = self.account_repo.list_by_user(user_id)
        return {
            "accounts": [
                {
                    "id": a.id,
                    "email": a.email_address,
                    "calendar_connected": has_calendar_scope(a.granted_scope),
                }
                for a in accounts
            ]
        }

    async def _sync_google_into_local(self, user_id: int, range_start: date, range_end: date) -> None:
        """Pull Google Calendar events for the visible range into the local `reminders`
        table, so the table is always the merged source of truth for rendering."""
        accounts = self.account_repo.list_by_user(user_id)
        calendar_accounts = [a for a in accounts if has_calendar_scope(a.granted_scope)]
        if not calendar_accounts:
            return

        time_min = datetime.combine(range_start, datetime.min.time(), tzinfo=timezone.utc)
        time_max = datetime.combine(range_end, datetime.max.time(), tzinfo=timezone.utc)

        for account in calendar_accounts:
            try:
                events = await self.calendar_connector.list_events(
                    user_id, time_min=time_min, time_max=time_max, email_account_id=account.id,
                )
            except ValueError as exc:
                logger.warning("Google Calendar sync failed for account %s: %s", account.id, exc)
                continue  # token/network failure for this account — skip, don't break the whole view

            for event in events:
                google_event_id = event.get("id")
                if not google_event_id:
                    continue

                if event.get("status") == "cancelled":
                    existing = self.reminder_repo.get_by_google_event_id(user_id, google_event_id)
                    if existing:
                        self.reminder_repo.delete(existing)
                    continue

                fields = google_event_to_reminder_fields(event)
                if not fields["due_date"]:
                    continue

                existing = self.reminder_repo.get_by_google_event_id(user_id, google_event_id)
                now = datetime.now(timezone.utc)
                if existing:
                    updated_str = event.get("updated")
                    if updated_str and existing.last_synced_at:
                        try:
                            updated_at = datetime.fromisoformat(updated_str.replace("Z", "+00:00"))
                            if updated_at <= existing.last_synced_at:
                                continue  # local copy is already current
                        except ValueError as exc:
                            logger.debug("Could not parse Google event 'updated' timestamp %r: %s", updated_str, exc)
                    self.reminder_repo.update_fields(
                        existing, **fields, calendar_account_id=account.id, last_synced_at=now,
                    )
                else:
                    self.reminder_repo.create_event(
                        user_id=user_id,
                        workspace_id=None,
                        type="manual",
                        done=False,
                        calendar_account_id=account.id,
                        last_synced_at=now,
                        **fields,
                    )

    async def list_events_in_range(
        self, user_id: int, workspace_id: Optional[int], range_start: date, range_end: date,
    ) -> list[dict]:
        await self._sync_google_into_local(user_id, range_start, range_end)
        reminders = self.reminder_repo.list_all(user_id, workspace_id)

        occurrences: list[dict] = []
        for r in reminders:
            if not r.due_date:
                continue
            try:
                start_date = date.fromisoformat(r.due_date)
            except ValueError as exc:
                logger.warning("Reminder %s has unparseable due_date %r, skipping from calendar view: %s", r.id, r.due_date, exc)
                continue
            for occ_date in expand_occurrences(r.recurrence_rule, start_date, range_start, range_end):
                occurrences.append({
                    "reminder_id": r.id,
                    "occurrence_date": occ_date.isoformat(),
                    "text": r.text,
                    "description": r.description,
                    "due_time": r.due_time,
                    "end_time": r.end_time,
                    "all_day": r.all_day,
                    "recurrence_rule": r.recurrence_rule,
                    "source": "google" if r.google_event_id else "local",
                    "done": r.done,
                })

        occurrences.sort(key=lambda o: (o["occurrence_date"], o["due_time"] or ""))
        return occurrences

    async def sync_to_google(self, user_id: int, reminder: Reminder, *, deleted: bool = False) -> None:
        """Push a create/update/delete of a local reminder to Google Calendar, if the
        user has a connected account with calendar scope. No-op otherwise (offline/local-only mode)."""
        account = None
        if reminder.calendar_account_id:
            account = self.account_repo.get_by_id(user_id, reminder.calendar_account_id)
        if not account or not has_calendar_scope(account.granted_scope):
            candidates = [a for a in self.account_repo.list_by_user(user_id) if has_calendar_scope(a.granted_scope)]
            account = candidates[0] if candidates else None
        if not account:
            return

        if deleted:
            if reminder.google_event_id:
                await self.calendar_connector.delete_event(
                    user_id, reminder.google_event_id, email_account_id=account.id,
                )
            return

        if not reminder.due_date:
            return

        event = reminder_to_google_event(
            text=reminder.text,
            description=reminder.description,
            due_date=reminder.due_date,
            due_time=reminder.due_time,
            end_time=reminder.end_time,
            all_day=reminder.all_day,
            recurrence_rule=reminder.recurrence_rule,
        )
        if reminder.google_event_id:
            result = await self.calendar_connector.update_event(
                user_id, reminder.google_event_id, event, email_account_id=account.id,
            )
        else:
            result = await self.calendar_connector.create_event(user_id, event, email_account_id=account.id)

        self.reminder_repo.update_fields(
            reminder,
            google_event_id=result.get("id"),
            google_calendar_id="primary",
            calendar_account_id=account.id,
            last_synced_at=datetime.now(timezone.utc),
        )
