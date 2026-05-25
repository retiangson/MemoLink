import { api } from "./client";
import type { User } from "../utils/auth";

export async function login(email: string, password: string): Promise<User> {
  return (await api.post("/auth/login", { email, password })).data;
}

export async function register(email: string, password: string): Promise<User> {
  return (await api.post("/auth/register", { email, password })).data;
}

export async function forgotPassword(email: string): Promise<void> {
  await api.post("/auth/forgot-password", { email });
}

export async function resetPassword(token: string, new_password: string): Promise<void> {
  await api.post("/auth/reset-password", { token, new_password });
}
