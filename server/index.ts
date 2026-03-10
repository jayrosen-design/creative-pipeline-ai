import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ProfanityEngine } from "@coffeeandfun/google-profanity-words";
import cors from "cors";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { buildReferenceUsage, getImageModelInfo, type ReferenceUsage } from "../shared/imageModels.ts";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 8787);
const LOCAL_ASSET_ROOT = path.resolve(__dirname, "../local-assets");
const LOCAL_MEDIA_ROOT = path.resolve(LOCAL_ASSET_ROOT, "media");
const HF_SPACE = "https://alexnasa-ltx-2-turbo.hf.space";
const BLOCKED_TERMS = ["banned", "unsafe", "guaranteed cure", "miracle", "risk-free"];
const BUILTIN_MEDIA_FOLDERS: Record<string, string> = {
  novapop: "NovaPop",
  ironoak: "IronOak",
};
const profanityEngines = new Map<"en" | "es", ProfanityEngine>();

type StorageProvider = "local" | "aws";

interface AwsConfig {
  aws_access_key_id: string;
  aws_secret_access_key: string;
  aws_region: string;
  aws_s3_bucket: string;
}

interface Product {
  id: string;
  name: string;
  tagline?: string;
  reference_images?: string[];
  reference_image?: string;
}

interface Brand {
  primary_color: string;
  font_family: string;
  logo_required: boolean;
  logo_safe_zone_percent?: number;
}

interface CampaignBrief {
  brand_name?: string;
  campaign_id: string;
  message: string;
  overlay_text?: string;
  markets?: string[];
  audience: string;
  languages?: string[];
  products: Product[];
  requested_ratios: string[];
  image_model?: string;
  brand: Brand;
  compliance_mode?: "strict" | "advisory";
  reference_image?: string;
  reference_images?: string[];
  output_type?: "image" | "video";
  market?: string;
  language?: string;
}

interface ComplianceCheck {
  check: string;
  status: "pass" | "fail" | "flag";
  details: string;
}

interface VariantResult {
  product_id: string;
  product_name: string;
  brand_name?: string;
  aspect_ratio: string;
  width?: number;
  height?: number;
  image_url: string;
  media_type?: "image" | "video";
  model_used?: string;
  reference_mode?: "none" | "native" | "prompt_only";
  reference_message?: string;
  reference_count?: number;
  prompt?: string;
  compliance: ComplianceCheck[];
}

interface GenerationRequestBody {
  brief: CampaignBrief;
  user_api_key?: string;
  user_base_url?: string;
  storage_provider?: StorageProvider;
  aws_config?: AwsConfig;
}

interface TranslateRequestBody {
  text: string;
  target_language: string;
  user_translate_key?: string;
  user_openai_key?: string;
  user_gemini_key?: string;
}

interface StoreAssetRequestBody {
  data_url: string;
  storage_path: string;
  storage_provider?: StorageProvider;
  aws_config?: AwsConfig;
}

interface MediaLibraryItem {
  id: string;
  brand_key: string;
  product_id?: string;
  name: string;
  url: string;
  source: "builtin" | "uploaded";
}

interface MediaLibraryUploadRequestBody {
  brand_key?: string;
  product_id?: string;
  data_url?: string;
  file_name?: string;
}

interface VideoRequest {
  campaign_id: string;
  product_id: string;
  product_name: string;
  product_tagline?: string;
  prompt: string;
  overlay_text?: string;
  audience?: string;
  market?: string;
  language?: string;
  brand_color?: string;
  font_family?: string;
  logo_required?: boolean;
  source_image_url?: string;
  reference_image_base64?: string;
  aspect_ratio: string;
  model?: string;
}

const app = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(
  "/assets",
  express.static(LOCAL_ASSET_ROOT, {
    setHeaders: (res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
    },
  }),
);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeStorageProvider(value?: string): StorageProvider {
  return value === "aws" ? "aws" : "local";
}

function safeText(value?: string | null): string {
  return (value ?? "").trim();
}

function sanitizeSegment(value?: string | null, fallback = "item"): string {
  const cleaned = safeText(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "_")
    .replace(/\.+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

function normalizeStoragePath(storagePath: string): string {
  return storagePath
    .split(/[\\/]+/)
    .map((segment) => sanitizeSegment(segment))
    .filter(Boolean)
    .join("/");
}

function buildAssetUrl(req: Request<any, any, any, any>, storagePath: string): string {
  const base = `${req.protocol}://${req.get("host")}`;
  const safePath = normalizeStoragePath(storagePath)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base}/assets/${safePath}`;
}

function resolveMediaBrandFolder(brandKey?: string): string {
  const normalizedBrandKey = sanitizeSegment(brandKey, "brand").toLowerCase();
  return BUILTIN_MEDIA_FOLDERS[normalizedBrandKey] || sanitizeSegment(brandKey, "brand");
}

function buildMediaStoragePath(brandKey: string, fileName: string, productId?: string): string {
  const ext = path.extname(fileName).replace(/^\./, "");
  const baseName = sanitizeSegment(path.basename(fileName, path.extname(fileName)), "media_item");
  const finalExt = ext || "png";
  const segments = ["media", resolveMediaBrandFolder(brandKey)];
  if (productId) {
    segments.push(sanitizeSegment(productId));
  }
  segments.push("uploaded", `${Date.now()}_${baseName}.${finalExt}`);
  return normalizeStoragePath(segments.join("/"));
}

async function walkFiles(rootDir: string): Promise<string[]> {
  try {
    const dirEntries = await readdir(rootDir, { withFileTypes: true });
    const nested = await Promise.all(
      dirEntries.map(async (entry) => {
        const fullPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
          return walkFiles(fullPath);
        }
        return [fullPath];
      }),
    );

    return nested.flat();
  } catch {
    return [];
  }
}

function inferProductIdFromMediaPath(absolutePath: string, brandFolder: string): string | undefined {
  const relativePath = path.relative(LOCAL_MEDIA_ROOT, absolutePath).split(path.sep).filter(Boolean);
  if (relativePath.length < 2) return undefined;
  if (relativePath[0] !== brandFolder) return undefined;
  const productSegment = relativePath[1];
  if (!productSegment || productSegment === "uploaded" || relativePath.length === 2) return undefined;
  return productSegment;
}

function buildMediaLibraryItem(req: Request<any, any, any, any>, brandKey: string, absolutePath: string): MediaLibraryItem {
  const brandFolder = resolveMediaBrandFolder(brandKey);
  const relativeAssetPath = normalizeStoragePath(path.relative(LOCAL_ASSET_ROOT, absolutePath));
  const productId = inferProductIdFromMediaPath(absolutePath, brandFolder);
  const name = path.basename(absolutePath, path.extname(absolutePath));
  const source = relativeAssetPath.includes("/uploaded/") ? "uploaded" : "builtin";

  return {
    id: relativeAssetPath,
    brand_key: brandKey,
    product_id: productId,
    name,
    url: buildAssetUrl(req, relativeAssetPath),
    source,
  };
}

function ratioDimensions(ratio: string): { w: number; h: number } {
  const exactSizeMatch = ratio.match(/^(\d+)x(\d+)$/i);
  if (exactSizeMatch) {
    return {
      w: Number(exactSizeMatch[1]),
      h: Number(exactSizeMatch[2]),
    };
  }

  switch (ratio) {
    case "9:16":
      return { w: 576, h: 1024 };
    case "16:9":
      return { w: 1024, h: 576 };
    case "4:5":
      return { w: 820, h: 1024 };
    case "300x250":
      return { w: 300, h: 250 };
    case "728x90":
      return { w: 728, h: 90 };
    case "160x600":
      return { w: 160, h: 600 };
    case "320x50":
      return { w: 320, h: 50 };
    case "970x250":
      return { w: 970, h: 250 };
    default:
      return { w: 1024, h: 1024 };
  }
}

function compositionHint(ratio: string, dims: { w: number; h: number }): string {
  const aspectValue = dims.w / dims.h;

  if (aspectValue >= 4) {
    return `Layout guidance: treat ${ratio} as a true panoramic banner. Use the full horizontal canvas, keep the subject fully visible, avoid close-up crops, and leave balanced space across the width for ad copy.`;
  }

  if (aspectValue <= 0.65) {
    return "Layout guidance: compose for a tall vertical frame with the main subject fully visible and enough breathing room above and below.";
  }

  return "Layout guidance: fit the subject naturally inside the full frame with comfortable margins.";
}

function collectReferenceImages(product?: Product, brief?: Pick<CampaignBrief, "reference_image" | "reference_images">): string[] {
  const all = [
    product?.reference_image,
    ...(product?.reference_images ?? []),
    brief?.reference_image,
    ...(brief?.reference_images ?? []),
  ]
    .map((value) => safeText(value))
    .filter(Boolean);
  return [...new Set(all)];
}

function referencePromptHint(referenceCount: number): string {
  return `Reference guidance: align the composition, styling, palette, and overall visual direction to the uploaded reference image set (${referenceCount} image${referenceCount === 1 ? "" : "s"}), while creating a new ad-ready scene.`;
}

function appendReferenceGuidance(prompt: string, referenceCount: number): string {
  if (referenceCount <= 0) return prompt;
  return `${prompt} ${referencePromptHint(referenceCount)}`;
}

function getProfanityEngine(language?: string): ProfanityEngine {
  const normalizedLanguage = language?.slice(0, 2).toLowerCase() === "es" ? "es" : "en";
  const existing = profanityEngines.get(normalizedLanguage);
  if (existing) {
    return existing;
  }

  const engine = new ProfanityEngine({ language: normalizedLanguage });
  profanityEngines.set(normalizedLanguage, engine);
  return engine;
}

async function runComplianceChecks(
  message: string,
  brand: Brand,
  mode: string,
  language?: string,
): Promise<ComplianceCheck[]> {
  const checks: ComplianceCheck[] = [];
  const blocked = BLOCKED_TERMS.find((term) => message.toLowerCase().includes(term.toLowerCase()));
  const profanityEngine = getProfanityEngine(language);
  const profanityMatches = await profanityEngine.getCurseWords(message);

  if (blocked || profanityMatches.length > 0) {
    const details = [
      blocked ? `Blocked term found: "${blocked}"` : "",
      profanityMatches.length > 0 ? `Profanity found: ${profanityMatches.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    checks.push({
      check: "legal_terms",
      status: mode === "strict" ? "fail" : "flag",
      details,
    });
  } else {
    checks.push({
      check: "legal_terms",
      status: "pass",
      details: "No blocked marketing terms or profanity detected.",
    });
  }

  if (brand.logo_required) {
    checks.push({
      check: "logo_presence",
      status: "pass",
      details: "Logo requirement acknowledged (placeholder).",
    });
  }

  if (brand.primary_color) {
    checks.push({
      check: "brand_primary_color",
      status: "pass",
      details: `Primary color ${brand.primary_color} registered for overlay.`,
    });
  }

  if (message.length > 200) {
    checks.push({
      check: "message_length",
      status: mode === "strict" ? "fail" : "flag",
      details: `Message exceeds 200 chars (${message.length}).`,
    });
  } else {
    checks.push({ check: "message_length", status: "pass", details: "Message length within limits." });
  }

  return checks;
}

function buildPrompt(
  brief: CampaignBrief,
  product: Product,
  ratio: string,
  dims: { w: number; h: number },
  renderOverlayTextNatively = false,
): string {
  const overlay = brief.overlay_text?.trim();
  const message = brief.message?.trim();
  const color = brief.brand.primary_color?.trim();
  const font = brief.brand.font_family?.trim();
  const safeZone = brief.brand.logo_safe_zone_percent ?? 12;

  return [
    `Create a premium branded campaign image for ${product.name}${product.tagline ? ` with the tagline "${product.tagline}"` : ""}.`,
    message
      ? `Campaign objective: ${message}.`
      : overlay
        ? `Creative direction: use the reference images to build the scene, and make the in-image message "${overlay}" the primary campaign idea.`
        : "Creative direction: create a polished ad-ready branded scene based on the product and reference images.",
    `Audience: ${brief.audience} in ${brief.market}.`,
    brief.language
      ? `Language context: ${brief.language}. Keep the visual style appropriate for this audience and region.`
      : "",
    "Style: polished commercial photography, campaign-ready, modern, high-end, visually striking, clean composition.",
    color ? `Color palette: emphasize ${color} as a core brand accent.` : "",
    font ? `Typography mood: visually compatible with ${font}, but do not render exact branded typography.` : "",
    overlay
      ? renderOverlayTextNatively
        ? `Render the exact overlay text "${overlay}" visibly inside the image with strong readability, correct spelling, and clean placement that feels like part of the finished ad creative.`
        : `Leave clean negative space for overlay copy reading "${overlay}", with strong readability and uncluttered background behind that text area.`
      : "Leave clean negative space for optional marketing copy placement.",
    brief.brand.logo_required
      ? `Reserve a logo-safe area of about ${safeZone}% of the frame, but do not render or invent a logo.`
      : "",
    `Compose for ${ratio} framing (${dims.w}x${dims.h}) with a clear focal point and balanced hierarchy.`,
    compositionHint(ratio, dims),
    renderOverlayTextNatively
      ? "High detail, premium lighting, realistic materials, no clutter, no watermark, no distorted details, and no extra gibberish text beyond the requested overlay."
      : "High detail, premium lighting, realistic materials, no clutter, no watermark, no distorted details, no fake text, no fake logos.",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildVideoPrompt(request: VideoRequest): string {
  const languageContext =
    request.language && request.language !== "en" ? ` Language: ${request.language}.` : "";
  const overlayTextContext = request.overlay_text
    ? ` Marketing copy to feature: "${request.overlay_text}".`
    : "";
  const logoContext = request.logo_required ? " Include brand logo placement." : "";
  const fontContext = request.font_family ? ` Typography: ${request.font_family}.` : "";
  const audienceContext = request.audience ? ` Target audience: ${request.audience}` : "";
  const marketContext = request.market ? ` in ${request.market}` : "";
  const brandColorContext = request.brand_color ? ` Brand color: ${request.brand_color}.` : "";
  const taglineContext = request.product_tagline ? ` — ${request.product_tagline}` : "";

  return `Professional marketing video for "${request.product_name}"${taglineContext}. Campaign message: "${request.prompt}".${overlayTextContext}${audienceContext}${marketContext}.${languageContext}${brandColorContext}${fontContext}${logoContext} Cinematic motion, smooth animation, professional commercial quality.`;
}

function dataUrlToFile(dataUrl: string, filename: string): File {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) {
    throw new Error("Reference images must be data URLs.");
  }

  const mimeType = match[1] || "image/png";
  const bytes = Buffer.from(match[2], "base64");
  return new File([bytes], filename, { type: mimeType });
}

function dataUrlToInlineData(dataUrl: string): { mimeType: string; data: string } {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) {
    throw new Error("Reference images must be data URLs.");
  }

  return {
    mimeType: match[1] || "image/png",
    data: match[2],
  };
}

function dataUrlToBytes(dataUrl: string): { bytes: Buffer; contentType: string } {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) {
    throw new Error("Asset data must be a data URL.");
  }

  return {
    contentType: match[1] || "application/octet-stream",
    bytes: Buffer.from(match[2], "base64"),
  };
}

function extensionFromContentType(contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("mp4")) return "mp4";
  if (ct.includes("webm")) return "webm";
  return "bin";
}

function getOpenAiSize(dims: { w: number; h: number }): string {
  const aspect = dims.w / dims.h;
  if (aspect >= 1.2) return "1536x1024";
  if (aspect <= 0.83) return "1024x1536";
  return "1024x1024";
}

function getGeminiAspectRatio(ratio: string): string {
  const normalized = ratio.toLowerCase();
  const supported = new Set(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]);
  if (supported.has(normalized)) return normalized;

  const exactSize = normalized.match(/^(\d+)x(\d+)$/);
  if (!exactSize) return "1:1";

  const width = Number(exactSize[1]);
  const height = Number(exactSize[2]);
  const aspect = width / height;

  if (aspect >= 3.2) return "21:9";
  if (aspect >= 1.55) return "16:9";
  if (aspect >= 1.2) return "4:3";
  if (aspect >= 0.95) return "1:1";
  if (aspect >= 0.72) return "4:5";
  return "9:16";
}

function clampMultipleOf32(value: number, min = 256, max = 1440): number {
  const clamped = Math.max(min, Math.min(max, value));
  return Math.max(min, Math.min(max, Math.round(clamped / 32) * 32));
}

function getFluxGenerationDimensions(dims: { w: number; h: number }): { w: number; h: number } {
  if (
    dims.w >= 256 &&
    dims.w <= 1440 &&
    dims.h >= 256 &&
    dims.h <= 1440 &&
    dims.w % 32 === 0 &&
    dims.h % 32 === 0
  ) {
    return dims;
  }

  const aspect = dims.w / dims.h;
  if (aspect >= 1) {
    const height = 256;
    const width = clampMultipleOf32(height * aspect);
    if (width < 1440) {
      return { w: width, h: height };
    }
    return { w: 1440, h: 256 };
  }

  const width = 256;
  const height = clampMultipleOf32(width / aspect);
  if (height < 1440) {
    return { w: width, h: height };
  }
  return { w: 256, h: 1440 };
}

async function fetchBytesFromUrl(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch remote asset (${response.status})`);
  }

  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

async function callFluxImageGeneration(
  baseUrl: string,
  apiKey: string,
  prompt: string,
  dims: { w: number; h: number },
): Promise<any> {
  const fluxDims = getFluxGenerationDimensions(dims);
  const submitRes = await fetch(`${baseUrl}/v1/flux-dev`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "Content-Type": "application/json",
      "x-key": apiKey,
    },
    body: JSON.stringify({
      prompt,
      width: fluxDims.w,
      height: fluxDims.h,
      steps: 28,
      guidance: 3,
      prompt_upsampling: false,
      output_format: "png",
    }),
  });

  const submitText = await submitRes.text();
  if (!submitRes.ok) {
    throw new Error(`Flux API error ${submitRes.status}: ${submitText}`);
  }

  const submission = JSON.parse(submitText);
  if (!submission?.polling_url) {
    throw new Error(`Flux API did not return a polling URL. Response: ${submitText}`);
  }

  for (let attempt = 0; attempt < 120; attempt += 1) {
    await wait(1000);
    const pollingUrl = new URL(submission.polling_url);
    if (submission.id && !pollingUrl.searchParams.has("id")) {
      pollingUrl.searchParams.set("id", submission.id);
    }

    const pollRes = await fetch(pollingUrl, {
      headers: {
        accept: "application/json",
        "x-key": apiKey,
      },
    });

    const pollText = await pollRes.text();
    if (!pollRes.ok) {
      throw new Error(`Flux polling error ${pollRes.status}: ${pollText}`);
    }

    const pollData = JSON.parse(pollText);
    if (pollData.status === "Ready") {
      if (!pollData?.result?.sample) {
        throw new Error(`Flux API returned Ready without an image URL. Response: ${pollText}`);
      }
      return { data: [{ url: pollData.result.sample }] };
    }

    if (["Error", "Task not found", "Request Moderated", "Content Moderated"].includes(pollData.status)) {
      throw new Error(`Flux generation failed: ${pollText}`);
    }
  }

  throw new Error("Flux generation timed out while polling for a result.");
}

async function callOpenAiImageGeneration(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  dims: { w: number; h: number },
): Promise<any> {
  console.log(`OpenAI image generation request: model=${model} size=${getOpenAiSize(dims)}`);
  const response = await fetch(`${baseUrl}/v1/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      size: getOpenAiSize(dims),
      quality: "high",
      output_format: "png",
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI image API error ${response.status}: ${text}`);
  }

  return JSON.parse(text);
}

async function callOpenAiImageEdits(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  dims: { w: number; h: number },
  references: string[],
): Promise<any> {
  console.log(`OpenAI image edit request: model=${model} size=${getOpenAiSize(dims)} references=${references.length}`);
  const formData = new FormData();
  formData.append("model", model);
  formData.append("prompt", prompt);
  formData.append("size", getOpenAiSize(dims));
  formData.append("quality", "high");
  formData.append("output_format", "png");

  references.forEach((reference, index) => {
    formData.append(
      references.length > 1 ? "image[]" : "image",
      dataUrlToFile(reference, `reference_${index + 1}.png`),
    );
  });

  const response = await fetch(`${baseUrl}/v1/images/edits`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI image edit API error ${response.status}: ${text}`);
  }

  return JSON.parse(text);
}

async function callGeminiImageGeneration(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  ratio: string,
  references: string[],
): Promise<any> {
  const parts: any[] = references.map((reference) => {
    const { mimeType, data } = dataUrlToInlineData(reference);
    return {
      inlineData: {
        mimeType,
        data,
      },
    };
  });

  parts.push({ text: prompt });
  const requestBody = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: {
        aspectRatio: getGeminiAspectRatio(ratio),
      },
    },
  };

  console.log("Gemini request body:", JSON.stringify(requestBody));

  const response = await fetch(
    `${baseUrl}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
  );

  const text = await response.text();
  console.log("Gemini response:", text);
  if (!response.ok) {
    throw new Error(`Gemini image generation error ${response.status}: ${text}`);
  }

  const data = JSON.parse(text);
  const imagePart = data?.candidates
    ?.flatMap((candidate: any) => candidate?.content?.parts ?? [])
    .find((part: any) => part?.inlineData?.data);

  if (!imagePart?.inlineData?.data) {
    throw new Error(`Gemini did not return an image. Response: ${text}`);
  }

  return {
    data: [
      {
        b64_json: imagePart.inlineData.data,
        mime_type: imagePart.inlineData.mimeType || "image/png",
      },
    ],
  };
}

async function translateWithGoogle(text: string, targetLanguage: string, apiKey: string): Promise<string> {
  const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: text,
      target: targetLanguage.slice(0, 2).toLowerCase(),
      format: "text",
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Google Translate API error ${response.status}: ${raw}`);
  }

  const data = JSON.parse(raw);
  return data.data?.translations?.[0]?.translatedText || text;
}

async function translateWithOpenAi(text: string, targetLanguage: string, apiKey: string): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a professional translator. Translate the given text to ${targetLanguage}. Return only the translated text. Keep brand names, product names, and proper nouns unchanged.`,
        },
        { role: "user", content: text },
      ],
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`OpenAI translation error ${response.status}: ${raw}`);
  }

  const data = JSON.parse(raw);
  return data.choices?.[0]?.message?.content?.trim() || text;
}

async function translateWithGemini(text: string, targetLanguage: string, apiKey: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `Translate the following text to ${targetLanguage}. Return only the translated text. Keep brand names, product names, and proper nouns unchanged.\n\n${text}`,
              },
            ],
          },
        ],
      }),
    },
  );

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini translation error ${response.status}: ${raw}`);
  }

  const data = JSON.parse(raw);
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || text;
}

async function extractImageBytesAndTypeFromResponse(
  data: any,
): Promise<{ bytes: Buffer; contentType: string }> {
  if (data.data?.[0]?.url) {
    return fetchBytesFromUrl(data.data[0].url);
  }

  if (data.data?.[0]?.b64_json) {
    return {
      bytes: Buffer.from(data.data[0].b64_json, "base64"),
      contentType: data.data[0].mime_type || "image/png",
    };
  }

  throw new Error("No image data returned from API");
}

async function normalizeImageSize(
  imageBytes: Buffer,
  dims: { w: number; h: number },
): Promise<{ bytes: Buffer; contentType: string }> {
  const bytes = await sharp(imageBytes)
    .resize({
      width: dims.w,
      height: dims.h,
      fit: "cover",
      position: "centre",
    })
    .png()
    .toBuffer();

  return { bytes, contentType: "image/png" };
}

async function saveToLocal(storagePath: string, bytes: Buffer): Promise<void> {
  const absolutePath = path.join(LOCAL_ASSET_ROOT, ...normalizeStoragePath(storagePath).split("/"));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);
  console.log(`Saved asset locally: ${absolutePath}`);
}

async function uploadToS3(
  awsConfig: AwsConfig,
  storagePath: string,
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  console.log(`Uploading asset to S3: bucket=${awsConfig.aws_s3_bucket} key=${normalizeStoragePath(storagePath)}`);
  const client = new S3Client({
    region: awsConfig.aws_region,
    credentials: {
      accessKeyId: awsConfig.aws_access_key_id,
      secretAccessKey: awsConfig.aws_secret_access_key,
    },
  });

  await client.send(
    new PutObjectCommand({
      Bucket: awsConfig.aws_s3_bucket,
      Key: normalizeStoragePath(storagePath),
      Body: bytes,
      ContentType: contentType,
    }),
  );

  return `https://${awsConfig.aws_s3_bucket}.s3.${awsConfig.aws_region}.amazonaws.com/${normalizeStoragePath(storagePath)}`;
}

function ensureAwsConfig(awsConfig?: AwsConfig): asserts awsConfig is AwsConfig {
  if (
    !awsConfig?.aws_access_key_id ||
    !awsConfig?.aws_secret_access_key ||
    !awsConfig?.aws_region ||
    !awsConfig?.aws_s3_bucket
  ) {
    throw new Error("AWS storage is selected, but the AWS configuration is incomplete.");
  }
}

async function saveAsset(
  req: Request<any, any, any, any>,
  storageProvider: StorageProvider | undefined,
  storagePath: string,
  bytes: Buffer,
  contentType: string,
  awsConfig?: AwsConfig,
): Promise<string> {
  if (normalizeStorageProvider(storageProvider) === "aws") {
    ensureAwsConfig(awsConfig);
    return uploadToS3(awsConfig, storagePath, bytes, contentType);
  }

  await saveToLocal(storagePath, bytes);
  return buildAssetUrl(req, storagePath);
}

async function uploadToGradio(blob: Blob, filename: string): Promise<string> {
  const formData = new FormData();
  formData.append("files", blob, filename);
  const response = await fetch(`${HF_SPACE}/gradio_api/upload`, {
    method: "POST",
    body: formData,
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Gradio upload failed (${response.status}): ${raw}`);
  }

  const paths = JSON.parse(raw);
  return paths[0];
}

async function callGradioVideoGen(
  prompt: string,
  firstFramePath: string | null,
  width: number,
  height: number,
): Promise<string> {
  const sessionHash = crypto.randomUUID().slice(0, 12);
  const joinRes = await fetch(`${HF_SPACE}/gradio_api/queue/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: [
        firstFramePath ? { path: firstFramePath } : null,
        null,
        prompt,
        5,
        null,
        firstFramePath ? "Image-to-Video" : "Text-to-Video",
        true,
        10,
        true,
        height,
        width,
        "No LoRA",
        null,
      ],
      fn_index: 5,
      session_hash: sessionHash,
    }),
  });

  const joinText = await joinRes.text();
  if (!joinRes.ok) {
    throw new Error(`Gradio queue join failed (${joinRes.status}): ${joinText}`);
  }

  const dataRes = await fetch(`${HF_SPACE}/gradio_api/queue/data?session_hash=${sessionHash}`, {
    headers: { Accept: "text/event-stream" },
  });

  if (!dataRes.ok || !dataRes.body) {
    const body = await dataRes.text().catch(() => "");
    throw new Error(`Gradio queue data failed (${dataRes.status}): ${body}`);
  }

  const reader = dataRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (!raw) continue;

      try {
        const event = JSON.parse(raw);
        if (event.msg === "process_completed" && event.output?.data) {
          const videoInfo = event.output.data[0];
          const videoUrl = videoInfo?.url || videoInfo?.path;
          if (!videoUrl) {
            throw new Error("No video URL in result");
          }
          return videoUrl.startsWith("http") ? videoUrl : `${HF_SPACE}/file=${videoUrl}`;
        }

        if (event.msg === "process_completed" && !event.success) {
          throw new Error(`Video generation failed: ${JSON.stringify(event.output || {})}`);
        }
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
  }

  throw new Error("Video generation stream ended without completion.");
}

function getVeoAspectRatio(ratio: string): "16:9" | "9:16" {
  const normalized = ratio.toLowerCase();
  if (normalized === "9:16") return "9:16";

  const exactSize = normalized.match(/^(\d+)x(\d+)$/);
  if (exactSize) {
    const width = Number(exactSize[1]);
    const height = Number(exactSize[2]);
    return width >= height ? "16:9" : "9:16";
  }

  return "16:9";
}

async function pollVeoOperation(
  baseUrl: string,
  apiKey: string,
  operationName: string,
): Promise<Record<string, any>> {
  while (true) {
    await wait(5000);
    const response = await fetch(`${baseUrl}/v1beta/${operationName}?key=${encodeURIComponent(apiKey)}`);
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`Veo operation polling failed (${response.status}): ${raw}`);
    }

    const data = JSON.parse(raw);
    if (data.done) {
      if (data.error) {
        throw new Error(`Veo generation failed: ${JSON.stringify(data.error)}`);
      }
      return data;
    }
  }
}

async function callVeoVideoGen(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  ratio: string,
  referenceImageBase64?: string,
): Promise<{ bytes: Buffer; contentType: string }> {
  const instances: Record<string, any>[] = [{ prompt }];
  if (referenceImageBase64) {
    const match = referenceImageBase64.match(/^data:(.*?);base64,(.*)$/);
    const mimeType = match?.[1] || "image/png";
    const bytesBase64Encoded = match?.[2] || referenceImageBase64;
    instances[0].image = {
      mimeType,
      bytesBase64Encoded,
    };
  }

  const response = await fetch(`${baseUrl}/v1beta/models/${model}:predictLongRunning?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      instances,
      parameters: {
        aspectRatio: getVeoAspectRatio(ratio),
        durationSeconds: 8,
        sampleCount: 1,
      },
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Veo video generation error ${response.status}: ${raw}`);
  }

  const operation = JSON.parse(raw);
  const operationName = operation?.name;
  if (!operationName) {
    throw new Error(`Veo did not return an operation name. Response: ${raw}`);
  }

  const completed = await pollVeoOperation(baseUrl, apiKey, operationName);
  const generatedVideo =
    completed?.response?.generatedVideos?.[0]?.video ||
    completed?.response?.generateVideoResponse?.generatedSamples?.[0]?.video;
  const fileName = generatedVideo?.name;
  const fileUri = generatedVideo?.uri;
  const downloadTarget = fileName
    ? `${baseUrl}/download/v1beta/${fileName}:download?alt=media&key=${encodeURIComponent(apiKey)}`
    : typeof fileUri === "string" && fileUri.startsWith("https://generativelanguage.googleapis.com/")
      ? `${fileUri}${fileUri.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`
      : null;

  if (!downloadTarget) {
    throw new Error(`Veo did not return a downloadable video file. Response: ${JSON.stringify(completed)}`);
  }

  const videoResponse = await fetch(downloadTarget);
  if (!videoResponse.ok) {
    const downloadRaw = await videoResponse.text().catch(() => "");
    throw new Error(`Veo download failed (${videoResponse.status}): ${downloadRaw}`);
  }

  return {
    bytes: Buffer.from(await videoResponse.arrayBuffer()),
    contentType: videoResponse.headers.get("content-type") || "video/mp4",
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/fetch-asset", async (req, res) => {
  try {
    const { url } = req.body as { url?: string };
    if (!url) {
      return res.status(400).json({ error: "url is required" });
    }

    const response = await fetch(url);
    if (!response.ok) {
      const message = await response.text().catch(() => "");
      return res.status(response.status).send(message || `Failed to fetch asset (${response.status})`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    res.setHeader("Content-Type", response.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    return res.send(bytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.post("/api/store-asset", async (req: Request<unknown, unknown, StoreAssetRequestBody>, res: Response) => {
  try {
    const { data_url, storage_path, storage_provider, aws_config } = req.body;
    if (!data_url || !storage_path) {
      return res.status(400).json({ error: "data_url and storage_path are required" });
    }

    const { bytes, contentType } = dataUrlToBytes(data_url);
    const publicUrl = await saveAsset(req, storage_provider, storage_path, bytes, contentType, aws_config);
    return res.json({ url: publicUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.get("/api/media-library", async (req: Request<unknown, unknown, unknown, { brand_key?: string }>, res: Response) => {
  try {
    const brandKey = safeText(req.query.brand_key);
    if (!brandKey) {
      return res.status(400).json({ error: "brand_key is required" });
    }

    const brandFolder = resolveMediaBrandFolder(brandKey);
    const brandRoot = path.join(LOCAL_MEDIA_ROOT, brandFolder);
    const files = await walkFiles(brandRoot);
    const supportedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
    const items = files
      .filter((filePath) => supportedExtensions.has(path.extname(filePath).toLowerCase()))
      .map((filePath) => buildMediaLibraryItem(req, brandKey, filePath))
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.json({ items });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.post(
  "/api/media-library",
  async (req: Request<unknown, unknown, MediaLibraryUploadRequestBody>, res: Response) => {
    try {
      const { brand_key, product_id, data_url, file_name } = req.body;
      if (!brand_key || !data_url) {
        return res.status(400).json({ error: "brand_key and data_url are required" });
      }

      const { bytes, contentType } = dataUrlToBytes(data_url);
      const extension = path.extname(file_name || "").replace(/^\./, "") || extensionFromContentType(contentType);
      const resolvedFileName = `${sanitizeSegment(file_name ? path.basename(file_name, path.extname(file_name)) : "media_item")}.${extension}`;
      const storagePath = buildMediaStoragePath(brand_key, resolvedFileName, product_id);

      await saveToLocal(storagePath, bytes);
      const absolutePath = path.join(LOCAL_ASSET_ROOT, ...storagePath.split("/"));
      const item = buildMediaLibraryItem(req, brand_key, absolutePath);
      return res.json({ item });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  },
);

app.post(
  "/api/translate-text",
  async (req: Request<unknown, unknown, TranslateRequestBody>, res: Response) => {
    try {
      const { text, target_language, user_translate_key, user_openai_key, user_gemini_key } = req.body;
      if (!text || !target_language) {
        return res.status(400).json({ error: "text and target_language are required" });
      }

      let translated = text;
      if (user_translate_key) {
        translated = await translateWithGoogle(text, target_language, user_translate_key);
      } else if (user_openai_key) {
        translated = await translateWithOpenAi(text, target_language, user_openai_key);
      } else if (user_gemini_key) {
        translated = await translateWithGemini(text, target_language, user_gemini_key);
      }

      return res.json({ translated_text: translated });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  },
);

app.post(
  "/api/generate-campaign",
  async (req: Request<unknown, unknown, GenerationRequestBody>, res: Response) => {
    try {
      const { brief, user_api_key, user_base_url, storage_provider, aws_config } = req.body;
      if (!brief) {
        return res.status(400).json({ error: "brief is required" });
      }
      if (!brief.products?.length) {
        return res.status(400).json({ error: "At least one product is required" });
      }

      const mode = brief.compliance_mode || "strict";
      const compliance = await runComplianceChecks(brief.message, brief.brand, mode, brief.language);
      const hasBlockingFailure = mode === "strict" && compliance.some((check) => check.status === "fail");
      if (hasBlockingFailure) {
        return res.status(422).json({ error: "Compliance gate failed", compliance });
      }

      const product = brief.products[0];
      const ratio = brief.requested_ratios?.[0] || "1:1";
      const dims = ratioDimensions(ratio);
      const modelInfo = getImageModelInfo(brief.image_model);
      const references = collectReferenceImages(product, brief);
      const prompt = buildPrompt(brief, product, ratio, dims, modelInfo.provider !== "litellm");
      let imageData: any;
      let referenceUsage: ReferenceUsage = buildReferenceUsage("none", 0, modelInfo.displayName);
      console.log(
        `Generate campaign image: model=${modelInfo.requestModel} provider=${modelInfo.provider} storage=${normalizeStorageProvider(storage_provider)} ratio=${ratio}`,
      );

      switch (modelInfo.provider) {
        case "openai": {
          const apiKey = user_api_key;
          const baseUrl = (user_base_url || "https://api.openai.com").replace(/\/+$/, "");
          if (!apiKey) throw new Error("OpenAI API key is not configured.");

          if (references.length > 0) {
            imageData = await callOpenAiImageEdits(
              baseUrl,
              apiKey,
              modelInfo.requestModel,
              prompt,
              dims,
              references,
            );
            referenceUsage = buildReferenceUsage("native", references.length, modelInfo.displayName);
          } else {
            imageData = await callOpenAiImageGeneration(
              baseUrl,
              apiKey,
              modelInfo.requestModel,
              prompt,
              dims,
            );
          }
          break;
        }

        case "gemini": {
          const apiKey = user_api_key;
          const baseUrl = (user_base_url || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
          if (!apiKey) throw new Error("Gemini API key is not configured.");

          imageData = await callGeminiImageGeneration(
            baseUrl,
            apiKey,
            modelInfo.requestModel,
            prompt,
            ratio,
            references,
          );
          if (references.length > 0) {
            referenceUsage = buildReferenceUsage("native", references.length, modelInfo.displayName);
          }
          break;
        }

        default: {
          const apiKey = user_api_key;
          const baseUrl = user_base_url?.replace(/\/+$/, "");
          if (!apiKey) throw new Error("Image generation API key is not configured.");
          if (!baseUrl) throw new Error("Image generation base URL is not configured.");

          imageData = await callOpenAiImageGeneration(
            baseUrl,
            apiKey,
            modelInfo.requestModel,
            appendReferenceGuidance(prompt, references.length),
            dims,
          );
          if (references.length > 0) {
            referenceUsage = buildReferenceUsage("prompt_only", references.length, modelInfo.displayName);
          }
          break;
        }
      }

      const extracted = await extractImageBytesAndTypeFromResponse(imageData);
      const normalizedImage = await normalizeImageSize(extracted.bytes, dims);
      const ratioSafe = ratio.replace(":", "x");
      const ts = Date.now();
      const storagePath = `${brief.campaign_id}/${product.id}/${ratioSafe}/${ts}.${extensionFromContentType(normalizedImage.contentType)}`;
      const publicUrl = await saveAsset(
        req,
        storage_provider,
        storagePath,
        normalizedImage.bytes,
        normalizedImage.contentType,
        aws_config,
      );
      console.log(`Generated image stored at: ${publicUrl}`);

      const variant: VariantResult = {
        product_id: product.id,
        product_name: product.name,
        brand_name: brief.brand_name,
        aspect_ratio: ratio,
        width: dims.w,
        height: dims.h,
        image_url: publicUrl,
        media_type: "image",
        model_used: modelInfo.displayName,
        reference_mode: referenceUsage.mode,
        reference_message: referenceUsage.message,
        reference_count: referenceUsage.count,
        prompt,
        compliance,
      };

      return res.json({ variant });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  },
);

app.post("/api/generate-video", async (req, res) => {
  try {
    const { request, user_api_key, user_base_url, storage_provider, aws_config } = req.body as {
      request?: VideoRequest;
      user_api_key?: string;
      user_base_url?: string;
      storage_provider?: StorageProvider;
      aws_config?: AwsConfig;
    };

    if (!request) {
      return res.status(400).json({ error: "request is required" });
    }

    const videoPrompt = buildVideoPrompt(request);
    const selectedVideoModel = request.model || "ltx-2-turbo";
    let videoBytes: Buffer;
    let videoContentType = "video/mp4";

    if (selectedVideoModel === "veo-3.1-generate-preview") {
      const apiKey = user_api_key;
      const baseUrl = (user_base_url || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
      if (!apiKey) {
        throw new Error("Gemini API key is required for Veo 3.1 video generation.");
      }

      const veoVideo = await callVeoVideoGen(
        baseUrl,
        apiKey,
        selectedVideoModel,
        videoPrompt,
        request.aspect_ratio,
        request.reference_image_base64,
      );
      videoBytes = veoVideo.bytes;
      videoContentType = veoVideo.contentType;
    } else {
      let firstFramePath: string | null = null;
      if (request.source_image_url) {
        const source = await fetchBytesFromUrl(request.source_image_url);
        firstFramePath = await uploadToGradio(new Blob([source.bytes], { type: source.contentType }), "first_frame.png");
      } else if (request.reference_image_base64) {
        const match = request.reference_image_base64.match(/^data:(.*?);base64,(.*)$/);
        const contentType = match?.[1] || "image/png";
        const base64 = match?.[2] || request.reference_image_base64;
        const bytes = Buffer.from(base64, "base64");
        firstFramePath = await uploadToGradio(new Blob([bytes], { type: contentType }), "first_frame.png");
      }

      let width = 768;
      let height = 512;
      switch (request.aspect_ratio) {
        case "9:16":
          width = 512;
          height = 768;
          break;
        case "16:9":
          width = 768;
          height = 512;
          break;
        case "4:5":
          width = 512;
          height = 640;
          break;
        case "1:1":
          width = 512;
          height = 512;
          break;
      }

      const remoteVideoUrl = await callGradioVideoGen(videoPrompt, firstFramePath, width, height);
      const remoteVideo = await fetchBytesFromUrl(remoteVideoUrl);
      videoBytes = remoteVideo.bytes;
      videoContentType = remoteVideo.contentType || "video/mp4";
    }

    const ratioSafe = request.aspect_ratio.replace(":", "x");
    const storagePath = `${request.campaign_id}/${request.product_id}/${ratioSafe}/${Date.now()}.mp4`;
    const publicUrl = await saveAsset(
      req,
      storage_provider,
      storagePath,
      videoBytes,
      videoContentType,
      aws_config,
    );

    return res.json({
      variant: {
        product_id: request.product_id,
        product_name: request.product_name,
        aspect_ratio: request.aspect_ratio,
        image_url: publicUrl,
        media_type: "video",
        model_used: selectedVideoModel === "veo-3.1-generate-preview" ? "Veo 3.1" : "LTX-2 Turbo",
        prompt: videoPrompt,
        compliance: [],
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

app.listen(PORT, async () => {
  await mkdir(LOCAL_ASSET_ROOT, { recursive: true });
  await mkdir(LOCAL_MEDIA_ROOT, { recursive: true });
  console.log(`Local API listening on http://localhost:${PORT}`);
});
