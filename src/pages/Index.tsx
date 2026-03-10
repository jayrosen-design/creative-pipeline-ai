import { useEffect, useState } from "react";
import { Anvil, ImageIcon, Layers } from "lucide-react";
import SettingsModal, { getStoredKeys } from "@/components/SettingsModal";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CampaignBriefForm from "@/components/CampaignBriefForm";
import ResultsGallery from "@/components/ResultsGallery";
import { postJson } from "@/lib/api";
import { saveAssetLocally } from "@/lib/localSave";
import { compositeTextOverlay } from "@/lib/textOverlay";
import type { CampaignBrief, GenerationManifest, VariantResult } from "@/types/campaign";
import { getImageModelInfo } from "../../shared/imageModels";

interface GeneratedVariantResponse {
  variant: VariantResult | null;
}

const getImageProviderConfig = (brief: CampaignBrief) => {
  const userKeys = getStoredKeys();
  const modelInfo = getImageModelInfo(brief.image_model);

  switch (modelInfo.provider) {
    case "openai":
      return {
        user_api_key: userKeys.openai_api_key || undefined,
        user_base_url: "https://api.openai.com",
      };
    case "gemini":
      return {
        user_api_key: userKeys.gemini_api_key || undefined,
        user_base_url: "https://generativelanguage.googleapis.com",
      };
    default:
      return {
        user_api_key: userKeys.flux_api_key || undefined,
        user_base_url: userKeys.flux_base_url || undefined,
      };
  }
};

const getVideoProviderConfig = (brief: CampaignBrief) => {
  const userKeys = getStoredKeys();
  const videoModel = brief.video_model || brief.image_model;

  if (videoModel === "veo-3.1-generate-preview") {
    return {
      user_api_key: userKeys.gemini_api_key || undefined,
      user_base_url: "https://generativelanguage.googleapis.com",
    };
  }

  return {
    user_api_key: undefined,
    user_base_url: undefined,
  };
};

const getStorageConfig = () => {
  const userKeys = getStoredKeys();
  return {
    storage_provider: userKeys.storage_provider || "local",
    aws_config:
      userKeys.storage_provider === "aws"
        ? {
            aws_access_key_id: userKeys.aws_access_key_id,
            aws_secret_access_key: userKeys.aws_secret_access_key,
            aws_region: userKeys.aws_region,
            aws_s3_bucket: userKeys.aws_s3_bucket,
          }
        : undefined,
  };
};

const STORAGE_KEY = "brandforge_gallery";

const loadPersistedManifest = (): GenerationManifest | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const blobToDataUrl = async (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to encode blob"));
    reader.readAsDataURL(blob);
  });

const storeCompositedAsset = async (blob: Blob, storagePath: string) => {
  const dataUrl = await blobToDataUrl(blob);
  const response = await postJson<{ url: string }>("/api/store-asset", {
    data_url: dataUrl,
    storage_path: storagePath,
    ...getStorageConfig(),
  });
  return response.url;
};

const Index = () => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [manifest, setManifest] = useState<GenerationManifest | null>(loadPersistedManifest);
  const [progress, setProgress] = useState(0);
  const [generationStatus, setGenerationStatus] = useState("");
  const [loadingPlaceholderCount, setLoadingPlaceholderCount] = useState(0);

  useEffect(() => {
    if (manifest) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(manifest));
    }
  }, [manifest]);

  const clearGallery = () => {
    setManifest(null);
    localStorage.removeItem(STORAGE_KEY);
    toast.success("Gallery cleared");
  };

  const deleteVariant = (index: number) => {
    setManifest((prev) => {
      if (!prev) return null;
      const updated = [...prev.variants];
      updated.splice(index, 1);
      if (updated.length === 0) {
        localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return { ...prev, variants: updated, total_variants: updated.length };
    });
  };

  const generateOneImage = async (
    brief: CampaignBrief,
    productIndex: number,
    ratio: string
  ): Promise<VariantResult | null> => {
    const imageProviderConfig = getImageProviderConfig(brief);
    const singleBrief: CampaignBrief = {
      ...brief,
      products: [brief.products[productIndex]],
      requested_ratios: [ratio],
    };

    const data = await postJson<GeneratedVariantResponse>("/api/generate-campaign", {
        brief: singleBrief,
        user_api_key: imageProviderConfig.user_api_key,
        user_base_url: imageProviderConfig.user_base_url,
        ...getStorageConfig(),
    });

    return data.variant || null;
  };

  const generateOneVideo = async (
    brief: CampaignBrief,
    productIndex: number,
    ratio: string
  ): Promise<VariantResult | null> => {
    const product = brief.products[productIndex];
    const videoProviderConfig = getVideoProviderConfig(brief);
    const data = await postJson<GeneratedVariantResponse>("/api/generate-video", {
        request: {
          campaign_id: brief.campaign_id,
          product_id: product.id,
          product_name: product.name,
          product_tagline: product.tagline,
          prompt: brief.message,
          overlay_text: brief.overlay_text,
          audience: brief.audience,
          market: brief.market,
          language: brief.language,
          brand_color: brief.brand.primary_color,
          font_family: brief.brand.font_family,
          logo_required: brief.brand.logo_required,
          reference_image_base64: product.reference_images?.[0] || product.reference_image,
          aspect_ratio: ratio,
          model: brief.video_model || brief.image_model,
        },
        user_api_key: videoProviderConfig.user_api_key,
        user_base_url: videoProviderConfig.user_base_url,
        ...getStorageConfig(),
    });
    return data.variant || null;
  };

  const translateText = async (text: string, targetLang: string): Promise<string> => {
    if (targetLang === "en") return text;
    const userKeys = getStoredKeys();
    const langNames: Record<string, string> = {
      es: "Spanish", fr: "French", de: "German", pt: "Portuguese",
      ja: "Japanese", ko: "Korean", ar: "Arabic", hi: "Hindi",
      zh: "Chinese (Simplified)", it: "Italian",
    };
    try {
      const data = await postJson<{ translated_text?: string }>("/api/translate-text", {
        text,
        target_language: langNames[targetLang] || targetLang,
        user_translate_key: userKeys.google_translate_key || undefined,
        user_openai_key: userKeys.openai_api_key || undefined,
        user_gemini_key: userKeys.gemini_api_key || undefined,
      });
      return data.translated_text || text;
    } catch (e) {
      console.warn("Translation failed, using original:", e);
      return text;
    }
  };

  const handleGenerate = async (brief: CampaignBrief) => {
    setIsGenerating(true);
    setProgress(0);
    const productsToGen = brief.products.filter((product) => product.name.trim());
    const ratiosToGen = brief.requested_ratios.length > 0 ? brief.requested_ratios : ["1:1"];

    const isVideo = brief.output_type === "video";
    const marketsToGen = brief.markets.length > 0 ? brief.markets : ["US"];
    const langsToGen = brief.languages.length > 0 ? brief.languages : ["en"];

    const totalCombos = productsToGen.length * ratiosToGen.length * marketsToGen.length * langsToGen.length;
    setLoadingPlaceholderCount(totalCombos);
    let completed = 0;

    try {
      for (const product of productsToGen) {
        for (const ratio of ratiosToGen) {
          for (const market of marketsToGen) {
            for (const lang of langsToGen) {
              const label = `${product.name} (${ratio}) — ${market}/${lang.toUpperCase()}`;
              setGenerationStatus(`Generating ${label}…`);

              const progressInterval = setInterval(() => {
                setProgress(() => Math.min(Math.floor(((completed + 0.5) / totalCombos) * 90), 89));
              }, isVideo ? 1500 : 600);

              // Translate overlay text
              let translatedOverlay = brief.overlay_text;
              if (lang !== "en" && brief.overlay_text) {
                setGenerationStatus(`Translating overlay to ${lang.toUpperCase()}…`);
                translatedOverlay = await translateText(brief.overlay_text, lang);
              }

              // Build single-combo brief
              const comboBrief: CampaignBrief = {
                ...brief,
                markets: [market],
                languages: [lang],
                market,
                language: lang,
                products: [product],
                requested_ratios: [ratio],
                overlay_text: translatedOverlay,
              };

              let variant: VariantResult | null;

              if (isVideo) {
                variant = await generateOneVideo(comboBrief, 0, ratio);
              } else {
                variant = await generateOneImage(comboBrief, 0, ratio);
              }

              clearInterval(progressInterval);

              if (variant) {
                const imageModelInfo = getImageModelInfo(brief.image_model);
                variant.model_used = isVideo
              ? variant.model_used || brief.video_model || brief.image_model || "LTX-2 Turbo"
                  : variant.model_used || imageModelInfo.displayName;
                variant.brand_name = variant.brand_name || brief.brand_name;
                variant.market = market;
                variant.language = lang;

                if (!isVideo && translatedOverlay && imageModelInfo.provider === "litellm") {
                  try {
                    const blob = await compositeTextOverlay(variant.image_url, translatedOverlay, {
                      fontFamily: brief.brand.font_family,
                      brandColor: brief.brand.primary_color,
                    });
                    const ratioSafe = ratio.replace(":", "x");
                    const compositedPath = `${brief.campaign_id}/${product.id}/${ratioSafe}/composited_${market}_${lang}_${Date.now()}.png`;
                    variant.image_url = await storeCompositedAsset(blob, compositedPath);
                  } catch (e) {
                    console.warn("Text overlay failed, using raw image:", e);
                  }
                }

                try {
                  const localSaveResult = await saveAssetLocally({
                    sourceUrl: variant.image_url,
                    brandName: variant.brand_name || brief.brand_name,
                    campaignId: brief.campaign_id,
                    productName: variant.product_name,
                    aspectRatio: variant.aspect_ratio,
                    market,
                    language: lang,
                  });

                  if (localSaveResult.mode === "folder") {
                    toast.success(`Saved locally: ${localSaveResult.path}`);
                  } else {
                    toast.success("Local download started");
                  }
                } catch (error) {
                  const message = error instanceof Error ? error.message : "Automatic local save failed";
                  console.warn("Automatic local save failed:", message);
                  toast.error(`Auto local save failed: ${message}`);
                }

                completed++;
                setLoadingPlaceholderCount(Math.max(totalCombos - completed, 0));
                setProgress(Math.floor((completed / totalCombos) * 95));

                setManifest((prev) => {
                  const existing = prev?.variants || [];
                  return {
                    campaign_id: brief.campaign_id,
                    provider_used: isVideo
                      ? "ltx-2-turbo"
                      : variant!.model_used || imageModelInfo.requestModel,
                    compliance_mode: brief.compliance_mode,
                    total_variants: existing.length + 1,
                    total_errors: 0,
                    variants: [...existing, variant!],
                  };
                });
                toast.success(
                  variant.reference_count && variant.reference_count > 0
                    ? `Generated ${label}. ${variant.reference_message}`
                    : `Generated ${label}`,
                );
              } else {
                completed++;
                setLoadingPlaceholderCount(Math.max(totalCombos - completed, 0));
                setProgress(Math.floor((completed / totalCombos) * 95));
                toast.error(`No ${isVideo ? "video" : "image"} generated for ${label}`);
              }
            }
          }
        }
      }
      setProgress(100);
    } catch (err: unknown) {
      console.error("Campaign generation error:", err);
      toast.error(err instanceof Error ? err.message : "Failed to generate campaign");
    } finally {
      setIsGenerating(false);
      setProgress(0);
      setGenerationStatus("");
      setLoadingPlaceholderCount(0);
    }
  };

  const hasVariants = manifest && manifest.variants.length > 0;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-card sticky top-0 z-10">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-primary">
            <Anvil className="h-5 w-5 text-primary-foreground" />
          </div>
          <h1 className="text-lg font-display font-bold tracking-tight text-foreground">
            Creative Pipeline AI
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <SettingsModal />
        </div>
      </header>

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-4 p-4 flex-1 items-start">
        {/* Left: Brief form */}
        <div className="lg:col-span-4 lg:sticky lg:top-20 self-start">
          <CampaignBriefForm
            onGenerate={handleGenerate}
            isGenerating={isGenerating}
            progress={progress}
          />
        </div>

        {/* Right: Studio + Gallery combined */}
        <div className="lg:col-span-8">
          <Card className="flex flex-col">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  <CardTitle className="text-base font-display">Generation Studio</CardTitle>
                </div>
                {hasVariants && (
                  <ResultsGallery
                    manifest={manifest}
                    isGenerating={isGenerating}
                    progress={progress}
                    onClearGallery={clearGallery}
                    headerOnly
                  />
                )}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {/* Loading state - compact */}
              {isGenerating && (
                <div className="flex items-center gap-4 p-4 rounded-lg border border-border bg-muted/30 animate-fade-in">
                  <div className="relative shrink-0">
                    <div className="h-10 w-10 rounded-full border-3 border-muted border-t-primary animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[10px] font-bold text-foreground">{progress}%</span>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {generationStatus || "Generating…"}
                    </p>
                    <div className="mt-1.5 w-full h-1 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Gallery inline */}
              {hasVariants ? (
                <ResultsGallery
                  manifest={manifest}
                  isGenerating={isGenerating}
                  progress={progress}
                    placeholderCount={loadingPlaceholderCount}
                  onClearGallery={clearGallery}
                  onDeleteVariant={deleteVariant}
                />
              ) : !isGenerating ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground py-12">
                  <ImageIcon className="h-12 w-12 opacity-30" />
                  <p className="text-sm">Select a brand, fill the brief, and generate.</p>
                    <p className="text-xs">Each selected product, size, market, and language becomes its own result.</p>
                </div>
                ) : (
                  <ResultsGallery
                    manifest={manifest}
                    isGenerating={isGenerating}
                    progress={progress}
                    placeholderCount={loadingPlaceholderCount}
                    onClearGallery={clearGallery}
                    onDeleteVariant={deleteVariant}
                  />
                )}
            </CardContent>
          </Card>
        </div>
      </section>
    </div>
  );
};

export default Index;
