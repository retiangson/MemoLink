import { api } from "./client";

export interface DesktopCommand {
  id: number;
  command_type: string;
  payload: Record<string, unknown>;
  status: "pending" | "running" | "done" | "failed";
  result: string | null;
}

export async function createDesktopCommand(
  commandType: string,
  payload: Record<string, unknown>
): Promise<DesktopCommand> {
  const res = await api.post("/desktop/commands", { command_type: commandType, payload });
  return res.data;
}

export async function getDesktopCommand(id: number): Promise<DesktopCommand> {
  const res = await api.get(`/desktop/commands/${id}`);
  return res.data;
}

export async function isDesktopOnline(): Promise<boolean> {
  try {
    const res = await api.get("/desktop/status");
    return res.data.online === true;
  } catch {
    return false;
  }
}

/**
 * Polls until the command is done or failed (or timeout).
 * Returns the final command object.
 */
export async function waitForDesktopCommand(
  id: number,
  timeoutMs = 60_000,
  intervalMs = 1_500
): Promise<DesktopCommand> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const cmd = await getDesktopCommand(id);
    if (cmd.status === "done" || cmd.status === "failed") return cmd;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Timed out waiting for desktop to execute command");
}
