import { apiUrl } from "@/lib/api";

const fetchViaProxy = async (url: string) => {
  const response = await fetch(apiUrl("/api/fetch-asset"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `Proxy fetch failed (${response.status})`);
  }

  return response.blob();
};

export const fetchAssetBlob = async (url: string) => {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Direct fetch failed (${response.status})`);
    }
    return response.blob();
  } catch {
    return fetchViaProxy(url);
  }
};
