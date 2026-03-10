import { describe, expect, it } from "vitest";
import { buildReferenceUsage, getImageModelInfo } from "../../shared/imageModels";

describe("image model support", () => {
  it("maps GPT image to native reference edits", () => {
    const model = getImageModelInfo("gpt-image");

    expect(model.requestModel).toBe("gpt-image-1");
    expect(model.provider).toBe("openai");
    expect(model.supportsNativeReferenceImages).toBe(true);
    expect(model.nativeReferenceEndpoint).toBe("edits");
  });

  it("falls back to prompt-guided references for flux", () => {
    const model = getImageModelInfo("flux.1-dev");
    const usage = buildReferenceUsage("prompt_only", 2, model.displayName);

    expect(model.supportsNativeReferenceImages).toBe(false);
    expect(model.provider).toBe("litellm");
    expect(usage.mode).toBe("prompt_only");
    expect(usage.count).toBe(2);
  });

  it("maps nano banana 2 to Gemini 3.1 Flash Image Preview", () => {
    const model = getImageModelInfo("nano-banana-2");

    expect(model.requestModel).toBe("gemini-3.1-flash-image-preview");
    expect(model.provider).toBe("gemini");
    expect(model.supportsNativeReferenceImages).toBe(true);
  });

  it("maps nano banana pro to Gemini 3 Pro Image", () => {
    const model = getImageModelInfo("nano-banana-pro");

    expect(model.requestModel).toBe("gemini-3-pro-image-preview");
    expect(model.provider).toBe("gemini");
    expect(model.supportsNativeReferenceImages).toBe(true);
  });
});
