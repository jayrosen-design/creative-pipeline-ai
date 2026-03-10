import { fetchAssetBlob } from "@/lib/assetFetch";

const DB_NAME = "brandforge-local-save";
const STORE_NAME = "handles";
const DIRECTORY_KEY = "asset-directory";

type PermissionMode = "read" | "readwrite";

type SaveAssetParams = {
  sourceUrl: string;
  brandName?: string;
  campaignId?: string;
  productName?: string;
  aspectRatio?: string;
  market?: string;
  language?: string;
};

const sanitizeSegment = (value?: string, fallback = "item") => {
  const cleaned = (value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\.+$/, "")
    .slice(0, 80);

  return cleaned || fallback;
};

const inferExtension = (url: string, contentType?: string | null) => {
  const lowerType = (contentType ?? "").toLowerCase();
  if (lowerType.includes("png")) return "png";
  if (lowerType.includes("jpeg") || lowerType.includes("jpg")) return "jpg";
  if (lowerType.includes("webp")) return "webp";
  if (lowerType.includes("gif")) return "gif";
  if (lowerType.includes("mp4")) return "mp4";
  if (lowerType.includes("webm")) return "webm";

  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    return match?.[1]?.toLowerCase() || "png";
  } catch {
    return "png";
  }
};

const openDatabase = async (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const getStoredDirectoryHandle = async (): Promise<FileSystemDirectoryHandle | null> => {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(DIRECTORY_KEY);

    request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
};

const setStoredDirectoryHandle = async (handle: FileSystemDirectoryHandle) => {
  const db = await openDatabase();

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(handle, DIRECTORY_KEY);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const clearStoredLocalSaveDirectory = async () => {
  const db = await openDatabase();

  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(DIRECTORY_KEY);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const ensurePermission = async (handle: FileSystemDirectoryHandle, mode: PermissionMode) => {
  const opts = { mode };

  if ((await handle.queryPermission(opts)) === "granted") {
    return true;
  }

  return (await handle.requestPermission(opts)) === "granted";
};

const getOrCreateSubdirectory = async (parent: FileSystemDirectoryHandle, name: string) =>
  parent.getDirectoryHandle(sanitizeSegment(name), { create: true });

export const supportsLocalFolderSave = () =>
  typeof window !== "undefined" &&
  "showDirectoryPicker" in window &&
  "indexedDB" in window;

export const hasStoredLocalSaveDirectory = async () => {
  if (!supportsLocalFolderSave()) return false;
  return Boolean(await getStoredDirectoryHandle());
};

export const chooseLocalSaveDirectory = async () => {
  if (!supportsLocalFolderSave()) {
    throw new Error("This browser does not support folder-based local saving.");
  }

  const handle = await window.showDirectoryPicker({ mode: "readwrite" });
  const granted = await ensurePermission(handle, "readwrite");

  if (!granted) {
    throw new Error("Folder access was not granted.");
  }

  await setStoredDirectoryHandle(handle);
  return handle.name;
};

const downloadViaBrowser = async ({
  sourceUrl,
  brandName,
  campaignId,
  productName,
  aspectRatio,
  market,
  language,
}: SaveAssetParams) => {
  const blob = await fetchAssetBlob(sourceUrl);
  const extension = inferExtension(sourceUrl, blob.type);
  const timestamp = Date.now();
  const fileName = [
    sanitizeSegment(brandName, "brand"),
    sanitizeSegment(campaignId, "campaign"),
    sanitizeSegment(productName, "product"),
    sanitizeSegment(aspectRatio, "asset"),
    market ? sanitizeSegment(market) : null,
    language ? sanitizeSegment(language) : null,
    String(timestamp),
  ]
    .filter(Boolean)
    .join("_");

  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `${fileName}.${extension}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);
};

export const saveAssetLocally = async (params: SaveAssetParams) => {
  if (!supportsLocalFolderSave()) {
    await downloadViaBrowser(params);
    return { mode: "download" as const };
  }

  const rootHandle = await getStoredDirectoryHandle();

  if (!rootHandle) {
    throw new Error("No local save folder is available. Re-select it in Settings.");
  }

  const granted = await ensurePermission(rootHandle, "readwrite");
  if (!granted) {
    throw new Error("Local folder access was denied.");
  }

  const blob = await fetchAssetBlob(params.sourceUrl);
  const extension = inferExtension(params.sourceUrl, blob.type);
  const brandDir = await getOrCreateSubdirectory(rootHandle, params.brandName || "brand");
  const campaignDir = await getOrCreateSubdirectory(brandDir, params.campaignId || "campaign");
  const productDir = await getOrCreateSubdirectory(campaignDir, params.productName || "product");
  const sizeDir = await getOrCreateSubdirectory(productDir, params.aspectRatio || "size");
  const timestamp = Date.now();

  const fileName = [
    sanitizeSegment(params.productName, "asset"),
    sanitizeSegment(params.aspectRatio, "size"),
    params.market ? sanitizeSegment(params.market) : null,
    params.language ? sanitizeSegment(params.language) : null,
    String(timestamp),
  ]
    .filter(Boolean)
    .join("_");

  const fileHandle = await sizeDir.getFileHandle(`${fileName}.${extension}`, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();

  return {
    mode: "folder" as const,
    path: `${sanitizeSegment(params.brandName, "brand")}/${sanitizeSegment(params.campaignId, "campaign")}/${sanitizeSegment(params.productName, "product")}/${sanitizeSegment(params.aspectRatio, "size")}/${fileName}.${extension}`,
  };
};
