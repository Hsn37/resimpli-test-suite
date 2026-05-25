export interface CallRecord {
  callId: string;
  agentId: string;
  agentName: string;
  mode: string;
  timestamp: number;
  duration: number;
}

const STORAGE_KEY = "resimpli-call-history";

export function getCallHistory(): CallRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function addCallRecord(record: CallRecord): void {
  const history = getCallHistory();
  history.unshift(record);
  if (history.length > 100) history.length = 100;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

export function clearCallHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}
