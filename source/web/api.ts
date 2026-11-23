export class RequestError extends Error {
  status: number;
  fields: Record<string, string>;
  constructor(status: number, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}
export async function request<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/" + path, {
    method, signal, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  }).catch(error => {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new RequestError(0, "Не удалось связаться с сервером. Попробуйте ещё раз");
  });
  const data = await response.json();
  if (!response.ok) throw new RequestError(response.status, data.message, data.fields);
  return data as T;
}
export const message = (error: unknown) => error instanceof Error ? error.message : "Не удалось выполнить действие";
export const fieldsFrom = (error: unknown) => error instanceof RequestError ? error.fields : {};
export const periodQuery = (from: string, to: string) => new URLSearchParams({ from, to }).toString();
export type Notify = (message: string, kind?: "error" | "success", undo?: () => void) => void;
