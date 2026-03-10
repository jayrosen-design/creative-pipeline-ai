const FALLBACK_API_BASE_URL = "http://localhost:8787";

export const getApiBaseUrl = () =>
  (import.meta.env.VITE_API_BASE_URL || FALLBACK_API_BASE_URL).replace(/\/+$/, "");

export const apiUrl = (path: string) => `${getApiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }

  return data as T;
}
