from types import SimpleNamespace


class FakeReminderRepository:
    def __init__(self):
        self.reminders = {}

    def create_reminder(
        self,
        user_id,
        text,
        workspace_id=None,
        description=None,
        reminder_type="manual",
        due_date=None,
        due_time=None,
        email_record_id=None,
    ):
        reminder = SimpleNamespace(
            id=len(self.reminders) + 1,
            user_id=user_id,
            text=text,
            workspace_id=workspace_id,
            description=description,
            type=reminder_type,
            due_date=due_date,
            due_time=due_time,
            email_record_id=email_record_id,
        )
        self.reminders[reminder.id] = reminder
        return reminder
