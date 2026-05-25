const KEY = "memolink_user";

export interface User {
  id: number;
  email: string;
  access_token: string;
  is_admin?: boolean;
  access_level?: "regular" | "plus" | "pro";
}

export function saveUser(user: User | null) {
  localStorage.setItem(KEY, JSON.stringify(user));
}

export function getUser(): User | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return getUser()?.access_token ?? null;
}

export function logout() {
  localStorage.removeItem(KEY);
}
