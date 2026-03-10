export type ReferenceUsageMode = "none" | "native" | "prompt_only";
export type ImageProvider = "litellm" | "openai" | "gemini";

export interface ImageModelInfo {
  inputModel: string;
  requestModel: string;
  displayName: string;
  provider: ImageProvider;
  supportsNativeReferenceImages: boolean;
  nativeReferenceEndpoint?: "edits";
  supportsAsyncPolling?: boolean;
}

export interface ReferenceUsage {
  mode: ReferenceUsageMode;
  count: number;
  message: string;
}

const IMAGE_MODELS: Record<string, ImageModelInfo> = {
  "flux.1-dev": {
    inputModel: "flux.1-dev",
    requestModel: "flux.1-dev",
    displayName: "Flux.1 Dev",
    provider: "litellm",
    supportsNativeReferenceImages: false,
  },
  "gpt-image": {
    inputModel: "gpt-image",
    requestModel: "gpt-image-1",
    displayName: "GPT-Image",
    provider: "openai",
    supportsNativeReferenceImages: true,
    nativeReferenceEndpoint: "edits",
  },
  "gpt-image-1": {
    inputModel: "gpt-image-1",
    requestModel: "gpt-image-1",
    displayName: "GPT-Image",
    provider: "openai",
    supportsNativeReferenceImages: true,
    nativeReferenceEndpoint: "edits",
  },
  "nano-banana-2": {
    inputModel: "nano-banana-2",
    requestModel: "gemini-3.1-flash-image-preview",
    displayName: "Nano Banana 2",
    provider: "gemini",
    supportsNativeReferenceImages: true,
  },
  "gemini-3.1-flash-image-preview": {
    inputModel: "gemini-3.1-flash-image-preview",
    requestModel: "gemini-3.1-flash-image-preview",
    displayName: "Nano Banana 2",
    provider: "gemini",
    supportsNativeReferenceImages: true,
  },
  "nano-banana-pro": {
    inputModel: "nano-banana-pro",
    requestModel: "gemini-3-pro-image-preview",
    displayName: "Nano Banana Pro",
    provider: "gemini",
    supportsNativeReferenceImages: true,
  },
  "gemini-3-pro-image-preview": {
    inputModel: "gemini-3-pro-image-preview",
    requestModel: "gemini-3-pro-image-preview",
    displayName: "Nano Banana Pro",
    provider: "gemini",
    supportsNativeReferenceImages: true,
  },
};

const DEFAULT_MODEL = IMAGE_MODELS["flux.1-dev"];

export function getImageModelInfo(model?: string | null): ImageModelInfo {
  return IMAGE_MODELS[model ?? ""] ?? {
    ...DEFAULT_MODEL,
    inputModel: model?.trim() || DEFAULT_MODEL.inputModel,
    requestModel: model?.trim() || DEFAULT_MODEL.requestModel,
    displayName: model?.trim() || DEFAULT_MODEL.displayName,
  };
}

export function buildReferenceUsage(
  mode: ReferenceUsageMode,
  count: number,
  displayName: string,
  reason?: string,
): ReferenceUsage {
  if (mode === "none" || count <= 0) {
    return {
      mode: "none",
      count: 0,
      message: "No reference images were provided.",
    };
  }

  if (mode === "native") {
    return {
      mode,
      count,
      message: `Applied ${count} reference image${count === 1 ? "" : "s"} natively with ${displayName}.`,
    };
  }

  return {
    mode,
    count,
    message:
      reason ||
      `${displayName} does not support native reference-image inputs here, so the references were used as prompt guidance.`,
  };
}
