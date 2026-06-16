import { api } from "./client";

export interface RunningProcess {
  proc_id: string;
  name: string;
  command: string;
  pid: number;
}

export async function listShellProcesses(): Promise<RunningProcess[]> {
  const res = await api.get("/shell/processes");
  return res.data.processes ?? [];
}

export async function killShellProcess(procId: string): Promise<void> {
  await api.delete(`/shell/processes/${procId}`);
}
