from dataclasses import dataclass


@dataclass
class UserRecord:
    id: int
    email: str
    password: str


class FakeUserRepository:
    def __init__(self):
        self.users_by_email = {}
        self.users_by_id = {}

    def get_by_email(self, email: str):
        return self.users_by_email.get(email)

    def get_by_id(self, user_id: int):
        return self.users_by_id.get(user_id)

    def create(self, email: str, hashed_password: str):
        user = UserRecord(len(self.users_by_id) + 1, email, hashed_password)
        self.users_by_email[email] = user
        self.users_by_id[user.id] = user
        return user

    def update_password(self, user_id: int, hashed_password: str):
        self.users_by_id[user_id].password = hashed_password
