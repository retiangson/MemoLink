import { api } from "./client";
import type { User } from "../utils/auth";

export async function login(email: string, password: string): Promise<User> {
  return (await api.post("/auth/login", { email, password })).data;
}

export async function register(email: string, password: string): Promise<User> {
  return (await api.post("/auth/register", { email, password })).data;
}
