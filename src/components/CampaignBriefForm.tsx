import { useState, useEffect, useRef } from "react";
import { Plus, X, Sparkles, Loader2, FileText, Upload, Video, ImageIcon, FileUp, ChevronDown, Check, Download } from "lucide-react";
import yaml from "js-yaml";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import type { CampaignBrief, Product } from "@/types/campaign";
import { apiUrl, postJson } from "@/lib/api";

const LOGO_STORAGE_KEY = "brandforge_logos";
const CUSTOM_BRAND_STORAGE_KEY = "brandforge_custom_brands";

const loadLogos = (): Record<string, string> => {
  try {
    const raw = localStorage.getItem(LOGO_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const saveLogos = (logos: Record<string, string>) => {
  localStorage.setItem(LOGO_STORAGE_KEY, JSON.stringify(logos));
};

interface BrandProfileDefaults {
  campaignId: string;
  message: string;
  overlayText: string;
  market: string;
  audience: string;
  products: Product[];
  brandColors: string[];
  fontFamily: string;
}

interface BrandProfile {
  name: string;
  theme: string;
  buttonClass: string;
  defaults: BrandProfileDefaults;
}

interface BriefDraft {
  brandName: string;
  campaignId: string;
  message: string;
  overlayText: string;
  markets: string[];
  audience: string;
  languages: string[];
  products: Product[];
  selectedRatios: string[];
  brandColors: string[];
  fontFamily: string;
  logoRequired: boolean;
  complianceMode: "strict" | "advisory";
  outputType: "image" | "video";
  selectedModel: string;
}

interface MediaLibraryItem {
  id: string;
  brand_key: string;
  product_id?: string;
  name: string;
  url: string;
  source: "builtin" | "uploaded";
}

const BUILTIN_BRAND_PROFILES: Record<string, BrandProfile> = {
  novapop: {
    name: "NovaPop",
    theme: "from-brand-novapop-from to-brand-novapop-to",
    buttonClass: "bg-brand-novapop-button hover:bg-brand-novapop-button-hover text-primary-foreground",
    defaults: {
      campaignId: "novapop_summer_2026",
      message: "Hyper-realistic 3D render of a NovaPop Cherry Fizz can splashing into a pool of glowing pink liquid, cyberpunk background.",
      overlayText: "Pop the vibe. NovaPop Cherry Fizz — Summer 2026",
      market: "US",
      audience: "Gen Z trend-setters",
      products: [
        { id: "cherry_fizz", name: "Cherry Fizz Can", tagline: "Pop the vibe." },
      ],
      brandColors: ["#e8368f", "#00c4cc", "#1a1a2e", "#f5f5f5", "#ff6b35"],
      fontFamily: "Space Grotesk",
    },
  },
  ironoak: {
    name: "Iron & Oak Hardware",
    theme: "from-brand-ironoak-from to-brand-ironoak-to",
    buttonClass: "bg-brand-ironoak-button hover:bg-brand-ironoak-button-hover text-primary-foreground",
    defaults: {
      campaignId: "ironoak_pro_2026",
      message: "Professional contractor wearing a hardhat, holding the Iron & Oak ProSeries Power Drill in a sunlit residential construction site.",
      overlayText: "Built to last. Iron & Oak ProSeries — For the Pros",
      market: "US",
      audience: "Professional contractors & DIY enthusiasts",
      products: [
        { id: "power_drill", name: "ProSeries Power Drill", tagline: "Built to last." },
      ],
      brandColors: ["#d97706", "#78350f", "#f5f0e8", "#1c1917", "#92400e"],
      fontFamily: "Inter",
    },
  },
};

const CUSTOM_BRAND_THEME = "from-primary to-primary";
const CUSTOM_BRAND_BUTTON_CLASS = "bg-primary hover:bg-primary/90 text-primary-foreground";
const BUILTIN_MEDIA_BRAND_KEYS = new Set(["novapop", "ironoak"]);
type ParsedBrief = Record<string, unknown>;
type ParsedProduct = Record<string, unknown>;

const loadCustomBrandProfiles = (): Record<string, BrandProfile> => {
  try {
    const raw = localStorage.getItem(CUSTOM_BRAND_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, BrandProfile>) : {};
  } catch {
    return {};
  }
};

const saveCustomBrandProfiles = (profiles: Record<string, BrandProfile>) => {
  localStorage.setItem(CUSTOM_BRAND_STORAGE_KEY, JSON.stringify(profiles));
};

const normalizeBrandKey = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "custom_brand";

const cloneProducts = (products: Product[]) =>
  products.map((product, index) => ({
    id: product.id || `product_${index + 1}`,
    name: product.name,
    tagline: product.tagline,
    reference_images: product.reference_images ? [...product.reference_images] : undefined,
    reference_image: product.reference_image,
  }));

const getDraftFromProfile = (profile: BrandProfile): BriefDraft => ({
  brandName: profile.name,
  campaignId: profile.defaults.campaignId,
  message: profile.defaults.message,
  overlayText: profile.defaults.overlayText,
  markets: [profile.defaults.market],
  audience: profile.defaults.audience,
  languages: ["en"],
  products: cloneProducts(profile.defaults.products),
  selectedRatios: ["1:1"],
  brandColors: [...profile.defaults.brandColors],
  fontFamily: profile.defaults.fontFamily,
  logoRequired: true,
  complianceMode: "strict",
  outputType: "image",
  selectedModel: "flux.1-dev",
});

const resolveBrandKey = (brandName: string, profiles: Record<string, BrandProfile>) => {
  const normalized = brandName.trim().toLowerCase();
  return Object.entries(profiles).find(([, profile]) => profile.name.trim().toLowerCase() === normalized)?.[0];
};

const toDataUrl = async (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(blob);
  });

const urlToDataUrl = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load media asset (${response.status})`);
  }
  return toDataUrl(await response.blob());
};

const normalizeProductLookupValue = (value?: string) =>
  (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

interface CampaignBriefFormProps {
  onGenerate: (brief: CampaignBrief) => void;
  isGenerating: boolean;
  progress: number;
}

const IMAGE_MODELS = [
  { value: "flux.1-dev", label: "Flux.1 Dev", desc: "High-quality image generation" },
  { value: "gpt-image", label: "GPT-Image", desc: "OpenAI image generation" },
  { value: "nano-banana-pro", label: "Nano Banana Pro", desc: "Gemini 3 Pro Image" },
  { value: "nano-banana-2", label: "Nano Banana 2", desc: "gemini-3.1-flash-image-preview" },
];

const VIDEO_MODELS = [
  { value: "ltx-2-turbo", label: "LTX-2 Turbo", desc: "Video generation" },
  { value: "veo-3.1-generate-preview", label: "Veo 3.1", desc: "Google video generation" },
];

const MAX_REFERENCE_IMAGE_COUNT = 5;
const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_REFERENCE_BYTES = 20 * 1024 * 1024;

const AVAILABLE_RATIOS = [
  { value: "1:1", label: "1:1", desc: "Square" },
  { value: "9:16", label: "9:16", desc: "Story / Reel" },
  { value: "16:9", label: "16:9", desc: "Landscape" },
  { value: "4:5", label: "4:5", desc: "Feed Post" },
  { value: "300x250", label: "300×250", desc: "Med Rectangle" },
  { value: "728x90", label: "728×90", desc: "Leaderboard" },
  { value: "160x600", label: "160×600", desc: "Skyscraper" },
  { value: "320x50", label: "320×50", desc: "Mobile Banner" },
  { value: "970x250", label: "970×250", desc: "Billboard" },
];

const AVAILABLE_MARKETS = [
  { value: "US", label: "🇺🇸 United States" },
  { value: "UK", label: "🇬🇧 United Kingdom" },
  { value: "DE", label: "🇩🇪 Germany" },
  { value: "FR", label: "🇫🇷 France" },
  { value: "JP", label: "🇯🇵 Japan" },
  { value: "BR", label: "🇧🇷 Brazil" },
  { value: "MX", label: "🇲🇽 Mexico" },
  { value: "IN", label: "🇮🇳 India" },
  { value: "KR", label: "🇰🇷 South Korea" },
  { value: "AE", label: "🇦🇪 UAE" },
  { value: "SA", label: "🇸🇦 Saudi Arabia" },
  { value: "AU", label: "🇦🇺 Australia" },
  { value: "CA", label: "🇨🇦 Canada" },
  { value: "IT", label: "🇮🇹 Italy" },
  { value: "ES", label: "🇪🇸 Spain" },
];

const AVAILABLE_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "ar", label: "Arabic" },
  { value: "hi", label: "Hindi" },
  { value: "zh", label: "Chinese (Simplified)" },
  { value: "it", label: "Italian" },
];

const CampaignBriefForm = ({ onGenerate, isGenerating, progress }: CampaignBriefFormProps) => {
  const [customBrands, setCustomBrands] = useState<Record<string, BrandProfile>>(loadCustomBrandProfiles);
  const [activeBrand, setActiveBrand] = useState("novapop");
  const allBrandProfiles = { ...BUILTIN_BRAND_PROFILES, ...customBrands };
  const brand = allBrandProfiles[activeBrand] ?? BUILTIN_BRAND_PROFILES.novapop;
  const d = brand.defaults;
  const skipBrandResetRef = useRef(false);

  const [campaignId, setCampaignId] = useState<string>(d.campaignId);
  const [message, setMessage] = useState<string>(d.message);
  const [overlayText, setOverlayText] = useState<string>(d.overlayText);
  const [markets, setMarkets] = useState<string[]>([d.market]);
  const [audience, setAudience] = useState<string>(d.audience);
  const [languages, setLanguages] = useState<string[]>(["en"]);
  const [products, setProducts] = useState<Product[]>([...d.products]);
  const [selectedRatios, setSelectedRatios] = useState<string[]>(["1:1"]);
  const [brandColors, setBrandColors] = useState<string[]>([...d.brandColors]);
  const [fontFamily, setFontFamily] = useState<string>(d.fontFamily);
  const [logoRequired, setLogoRequired] = useState(true);
  const [complianceMode, setComplianceMode] = useState<"strict" | "advisory">("strict");
  const [logos, setLogos] = useState<Record<string, string>>(loadLogos);
  const [mediaLibraryByBrand, setMediaLibraryByBrand] = useState<Record<string, MediaLibraryItem[]>>({});
  const [loadingMediaLibrary, setLoadingMediaLibrary] = useState(false);
  const [libraryModalProductIndex, setLibraryModalProductIndex] = useState<number | null>(null);
  const [outputType, setOutputType] = useState<"image" | "video">("image");
  const [selectedModel, setSelectedModel] = useState("flux.1-dev");
  const logoInputRef = useRef<HTMLInputElement>(null);
  const briefUploadRef = useRef<HTMLInputElement>(null);
  const productRefInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const skippedAutoSeedRefs = useRef<Set<string>>(new Set());
  const autoSeededRefs = useRef<Set<string>>(new Set());
  const lastImageModelRef = useRef(IMAGE_MODELS[0].value);
  const lastVideoModelRef = useRef(VIDEO_MODELS[0].value);

  const applyDraft = (draft: BriefDraft) => {
    setCampaignId(draft.campaignId);
    setMessage(draft.message);
    setOverlayText(draft.overlayText);
    setMarkets(draft.markets);
    setAudience(draft.audience);
    setLanguages(draft.languages);
    setProducts(cloneProducts(draft.products));
    setSelectedRatios(draft.selectedRatios);
    setBrandColors([...draft.brandColors]);
    setFontFamily(draft.fontFamily);
    setLogoRequired(draft.logoRequired);
    setComplianceMode(draft.complianceMode);
    setOutputType(draft.outputType);
    setSelectedModel(draft.selectedModel);
  };

  const currentMediaLibrary = mediaLibraryByBrand[activeBrand] ?? [];
  const activeLibraryProduct = libraryModalProductIndex !== null ? products[libraryModalProductIndex] : null;
  const availableModels = outputType === "video" ? VIDEO_MODELS : IMAGE_MODELS;

  const getLibraryCandidatesForProduct = (product: Product, libraryItems: MediaLibraryItem[]) => {
    if (libraryItems.length === 0) return [];
    const productIdKey = normalizeProductLookupValue(product.id);
    const productNameKey = normalizeProductLookupValue(product.name);

    const exactMatches = libraryItems.filter((item) => {
      const itemProductKey = normalizeProductLookupValue(item.product_id);
      const itemNameKey = normalizeProductLookupValue(item.name);
      return (
        (itemProductKey && itemProductKey === productIdKey) ||
        (productIdKey && itemNameKey.includes(productIdKey)) ||
        (productNameKey && itemNameKey.includes(productNameKey))
      );
    });

    if (exactMatches.length > 0) {
      return exactMatches;
    }

    if (products.length === 1) {
      return libraryItems;
    }

    return [];
  };

  const addReferenceImagesToProduct = (productIndex: number, newImages: string[]) => {
    setProducts((prev) =>
      prev.map((item, index) => {
        if (index !== productIndex) return item;
        const combined = [...(item.reference_images ?? []), ...newImages];
        const deduped = Array.from(new Set(combined)).slice(0, MAX_REFERENCE_IMAGE_COUNT);
        return {
          ...item,
          reference_images: deduped,
          reference_image: deduped[0],
        };
      }),
    );
  };

  const loadMediaLibrary = async (brandKey: string) => {
    setLoadingMediaLibrary(true);
    try {
      const response = await fetch(`${apiUrl("/api/media-library")}?brand_key=${encodeURIComponent(brandKey)}`);
      const text = await response.text();
      const data = text ? (JSON.parse(text) as { items?: MediaLibraryItem[]; error?: string }) : {};
      if (!response.ok) {
        throw new Error(data.error || `Failed to load media library (${response.status})`);
      }
      setMediaLibraryByBrand((prev) => ({
        ...prev,
        [brandKey]: data.items ?? [],
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load media library";
      toast.error(message);
      setMediaLibraryByBrand((prev) => ({
        ...prev,
        [brandKey]: [],
      }));
    } finally {
      setLoadingMediaLibrary(false);
    }
  };

  const addLibraryItemToProduct = async (productIndex: number, item: MediaLibraryItem) => {
    const existingCount = products[productIndex]?.reference_images?.length ?? 0;
    if (existingCount >= MAX_REFERENCE_IMAGE_COUNT) {
      toast.error(`Maximum ${MAX_REFERENCE_IMAGE_COUNT} reference images allowed per product`);
      return;
    }

    try {
      const dataUrl = await urlToDataUrl(item.url);
      addReferenceImagesToProduct(productIndex, [dataUrl]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add media item";
      toast.error(message);
    }
  };

  const createDraftFromParsedBrief = (parsed: ParsedBrief): BriefDraft => {
    const brandConfig =
      parsed.brand && typeof parsed.brand === "object" ? (parsed.brand as ParsedBrief) : undefined;
    const parsedMarkets = Array.isArray(parsed.markets)
      ? parsed.markets.filter((value): value is string => typeof value === "string")
      : typeof parsed.market === "string" && parsed.market.trim()
        ? [parsed.market]
        : [brand.defaults.market];
    const parsedLanguages = Array.isArray(parsed.languages)
      ? parsed.languages.filter((value): value is string => typeof value === "string")
      : typeof parsed.language === "string" && parsed.language.trim()
        ? [parsed.language]
        : ["en"];
    const parsedRatios = Array.isArray(parsed.requested_ratios)
      ? parsed.requested_ratios.filter((value): value is string => typeof value === "string")
      : ["1:1"];
    const parsedProducts = Array.isArray(parsed.products)
      ? parsed.products.map((rawProduct, i: number) => {
          const product = rawProduct as ParsedProduct;
          return {
            id: typeof product.id === "string" && product.id.trim() ? product.id : `product_${i + 1}`,
            name: typeof product.name === "string" ? product.name : "",
            tagline: typeof product.tagline === "string" ? product.tagline : "",
            reference_images: Array.isArray(product.reference_images)
              ? product.reference_images.filter((img: unknown): img is string => typeof img === "string")
              : typeof product.reference_image === "string" && product.reference_image.trim()
                ? [product.reference_image.trim()]
                : [],
            reference_image:
              typeof product.reference_image === "string" && product.reference_image.trim()
                ? product.reference_image.trim()
                : undefined,
          };
        })
      : cloneProducts(brand.defaults.products);
    const legacyReferenceImages = Array.isArray(parsed.reference_images)
      ? parsed.reference_images.filter((img: unknown): img is string => typeof img === "string")
      : typeof parsed.reference_image === "string" && parsed.reference_image.trim()
        ? [parsed.reference_image.trim()]
        : [];

    if (legacyReferenceImages.length > 0 && parsedProducts[0] && (parsedProducts[0].reference_images?.length ?? 0) === 0) {
      parsedProducts[0].reference_images = legacyReferenceImages;
      parsedProducts[0].reference_image = legacyReferenceImages[0];
    }

    const fallbackColors = brand.defaults.brandColors;
    const primaryColor =
      typeof brandConfig?.primary_color === "string" && brandConfig.primary_color.trim()
        ? brandConfig.primary_color
        : fallbackColors[0] || "#000000";

    return {
      brandName:
        typeof parsed.brand_name === "string" && parsed.brand_name.trim() ? parsed.brand_name.trim() : brand.name,
      campaignId:
        typeof parsed.campaign_id === "string" && parsed.campaign_id.trim()
          ? parsed.campaign_id
          : `${normalizeBrandKey(brand.name)}_campaign`,
      message: typeof parsed.message === "string" ? parsed.message : brand.defaults.message,
      overlayText: typeof parsed.overlay_text === "string" ? parsed.overlay_text : brand.defaults.overlayText,
      markets: parsedMarkets.length > 0 ? parsedMarkets : [brand.defaults.market],
      audience: typeof parsed.audience === "string" ? parsed.audience : brand.defaults.audience,
      languages: parsedLanguages.length > 0 ? parsedLanguages : ["en"],
      products: parsedProducts,
      selectedRatios: parsedRatios.length > 0 ? parsedRatios : ["1:1"],
      brandColors: [primaryColor, ...fallbackColors.slice(1)],
      fontFamily:
        typeof brandConfig?.font_family === "string" && brandConfig.font_family.trim()
          ? brandConfig.font_family
          : brand.defaults.fontFamily,
      logoRequired:
        typeof brandConfig?.logo_required === "boolean" ? brandConfig.logo_required : true,
      complianceMode:
        parsed.compliance_mode === "strict" || parsed.compliance_mode === "advisory"
          ? parsed.compliance_mode
          : "strict",
      outputType:
        parsed.output_type === "image" || parsed.output_type === "video" ? parsed.output_type : "image",
      selectedModel:
        typeof parsed.image_model === "string" && parsed.image_model.trim()
          ? parsed.image_model.trim()
          : "flux.1-dev",
    };
  };

  const handleBriefUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        let parsed: ParsedBrief;
        if (file.name.endsWith(".yaml") || file.name.endsWith(".yml")) {
          const loaded = yaml.load(text);
          if (!loaded || typeof loaded !== "object") {
            throw new Error("Invalid brief format");
          }
          parsed = loaded as ParsedBrief;
        } else {
          const loaded = JSON.parse(text) as unknown;
          if (!loaded || typeof loaded !== "object") {
            throw new Error("Invalid brief format");
          }
          parsed = loaded as ParsedBrief;
        }
        const draft = createDraftFromParsedBrief(parsed);
        applyDraft(draft);

        const matchedBuiltInKey = resolveBrandKey(draft.brandName, BUILTIN_BRAND_PROFILES);
        if (matchedBuiltInKey) {
          skipBrandResetRef.current = true;
          setActiveBrand(matchedBuiltInKey);
          toast.success("Brief loaded successfully");
        } else {
          const customKey = resolveBrandKey(draft.brandName, customBrands) || normalizeBrandKey(draft.brandName);
          const customProfile: BrandProfile = {
            name: draft.brandName,
            theme: CUSTOM_BRAND_THEME,
            buttonClass: CUSTOM_BRAND_BUTTON_CLASS,
            defaults: {
              campaignId: draft.campaignId,
              message: draft.message,
              overlayText: draft.overlayText,
              market: draft.markets[0] || "US",
              audience: draft.audience,
              products: cloneProducts(draft.products),
              brandColors: [...draft.brandColors],
              fontFamily: draft.fontFamily,
            },
          };
          const nextCustomBrands = { ...customBrands, [customKey]: customProfile };
          setCustomBrands(nextCustomBrands);
          saveCustomBrandProfiles(nextCustomBrands);
          skipBrandResetRef.current = true;
          setActiveBrand(customKey);
          toast.success(`Saved "${draft.brandName}" as a reusable brand profile`);
        }
      } catch (err) {
        toast.error("Failed to parse file. Please upload a valid JSON or YAML file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  useEffect(() => {
    if (skipBrandResetRef.current) {
      skipBrandResetRef.current = false;
      return;
    }
    const profile = allBrandProfiles[activeBrand];
    if (!profile) return;
    applyDraft(getDraftFromProfile(profile));
  }, [activeBrand]);

  useEffect(() => {
    void loadMediaLibrary(activeBrand);
  }, [activeBrand]);

  useEffect(() => {
    if (outputType === "video") {
      if (IMAGE_MODELS.some((model) => model.value === selectedModel)) {
        lastImageModelRef.current = selectedModel;
      }
      if (VIDEO_MODELS.some((model) => model.value === selectedModel)) {
        lastVideoModelRef.current = selectedModel;
        return;
      }
      setSelectedModel(lastVideoModelRef.current || VIDEO_MODELS[0].value);
      return;
    }

    if (IMAGE_MODELS.some((model) => model.value === selectedModel)) {
      lastImageModelRef.current = selectedModel;
      return;
    }

    setSelectedModel(lastImageModelRef.current || IMAGE_MODELS[0].value);
  }, [outputType, selectedModel]);

useEffect(() => {
  if (!BUILTIN_MEDIA_BRAND_KEYS.has(activeBrand)) return;
  if (currentMediaLibrary.length === 0) return;

  const runAutoSeed = async () => {
    for (let index = 0; index < products.length; index += 1) {
      const product = products[index];
      const autoSeedKey = `${activeBrand}:${product.id}`;

      if ((product.reference_images?.length ?? 0) > 0) continue;
      if (skippedAutoSeedRefs.current.has(autoSeedKey)) continue;

      // For built-in brands, prefer only built-in folder images (not uploaded)
      const builtinOnly = currentMediaLibrary.filter((item) => item.source === "builtin");
      const seedPool = builtinOnly.length > 0 ? builtinOnly : currentMediaLibrary;

      const candidates = getLibraryCandidatesForProduct(product, seedPool).slice(0, MAX_REFERENCE_IMAGE_COUNT);
      if (candidates.length === 0) continue;

      try {
        const dataUrls = await Promise.all(candidates.map((item) => urlToDataUrl(item.url)));
        addReferenceImagesToProduct(index, dataUrls);
      } catch (error) {
        console.warn("Failed to auto-seed media references:", error);
      }
    }
  };

  void runAutoSeed();
}, [activeBrand, currentMediaLibrary, products]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("Logo must be under 5MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const updated = { ...logos, [activeBrand]: dataUrl };
      setLogos(updated);
      saveLogos(updated);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const removeLogo = () => {
    const updated = { ...logos };
    delete updated[activeBrand];
    setLogos(updated);
    saveLogos(updated);
  };

  const handleRefImageUpload = async (productIndex: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const product = products[productIndex];
    const existingImages = product.reference_images ?? [];
    const remainingSlots = MAX_REFERENCE_IMAGE_COUNT - existingImages.length;

    if (remainingSlots <= 0) {
      toast.error(`Maximum ${MAX_REFERENCE_IMAGE_COUNT} reference images allowed per product`);
      return;
    }

    const filesToProcess = Array.from(files).slice(0, remainingSlots);
    let nextTotalBytes = existingImages.reduce((sum, image) => {
      const base64 = image.split(",")[1] || image;
      return sum + Math.ceil((base64.length * 3) / 4);
    }, 0);
    const filesAccepted: File[] = [];

    filesToProcess.forEach((file) => {
      if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
        toast.error(`${file.name} is too large. Reference images must be under 10MB`);
        return;
      }
      nextTotalBytes += file.size;
      if (nextTotalBytes > MAX_TOTAL_REFERENCE_BYTES) {
        toast.error("Reference images for a product are too large in total. Keep the combined upload under 20MB.");
        nextTotalBytes -= file.size;
        return;
      }
      filesAccepted.push(file);
    });

    const newImages = await Promise.all(
      filesAccepted.map(async (file) => ({
        file,
        dataUrl: await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
          reader.readAsDataURL(file);
        }),
      })),
    ).catch((error) => {
      const message = error instanceof Error ? error.message : "Failed to read reference image";
      toast.error(message);
      return [];
    });

    if (newImages.length > 0) {
      addReferenceImagesToProduct(
        productIndex,
        newImages.map((item) => item.dataUrl),
      );

      const uploadedItems = await Promise.all(
        newImages.map(async ({ file, dataUrl }) => {
          try {
            const response = await postJson<{ item: MediaLibraryItem }>("/api/media-library", {
              brand_key: activeBrand,
              product_id: product.id,
              data_url: dataUrl,
              file_name: file.name,
            });
            return response.item;
          } catch (error) {
            console.warn("Failed to save media library item:", error);
            return null;
          }
        }),
      );

      const validItems = uploadedItems.filter((item): item is MediaLibraryItem => Boolean(item));
      if (validItems.length > 0) {
        setMediaLibraryByBrand((prev) => ({
          ...prev,
          [activeBrand]: [...(prev[activeBrand] ?? []), ...validItems],
        }));
      }
    }

    e.target.value = "";
  };

  const removeReferenceImage = (productIndex: number, imageIndex: number) => {
    const productId = products[productIndex]?.id;
    if (productId) {
      skippedAutoSeedRefs.current.add(`${activeBrand}:${productId}`);
    }
    setProducts((prev) =>
      prev.map((item, index) => {
        if (index !== productIndex) return item;
        const remaining = (item.reference_images ?? []).filter((_, i) => i !== imageIndex);
        return {
          ...item,
          reference_images: remaining,
          reference_image: remaining[0],
        };
      }),
    );
  };

  const updateBrandColor = (index: number, color: string) => {
    const updated = [...brandColors];
    updated[index] = color;
    setBrandColors(updated);
  };

  const addProduct = () => {
    const idx = products.length + 1;
    setProducts([...products, { id: `product_${idx}`, name: "", tagline: "", reference_images: [] }]);
  };

  const removeProduct = (index: number) => {
    setProducts(products.filter((_, i) => i !== index));
  };

  const updateProduct = (index: number, field: keyof Product, value: string) => {
    const updated = [...products];
    updated[index] = { ...updated[index], [field]: value };
    setProducts(updated);
  };

  const toggleRatio = (ratio: string) => {
    setSelectedRatios((prev) =>
      prev.includes(ratio) ? prev.filter((r) => r !== ratio) : [...prev, ratio]
    );
  };

  const handleSubmit = () => {
    const productsWithRefs = products.filter((p) => (p.reference_images?.length ?? 0) > 0);
    const invalidProduct = productsWithRefs.find((product) => {
      const totalReferenceBytes = (product.reference_images ?? []).reduce((sum, image) => {
        const base64 = image.split(",")[1] || image;
        return sum + Math.ceil((base64.length * 3) / 4);
      }, 0);
      return totalReferenceBytes > MAX_TOTAL_REFERENCE_BYTES;
    });
    if (invalidProduct) {
      toast.error(`Reference images for ${invalidProduct.name || "a product"} are too large. Keep the combined upload under 20MB.`);
      return;
    }

    const brief: CampaignBrief = {
      brand_name: brand.name,
      campaign_id: campaignId,
      message,
      overlay_text: overlayText,
      markets,
      audience,
      languages,
      products: products
        .filter((p) => p.name.trim())
        .map((product) => ({
          ...product,
          reference_images: product.reference_images?.length ? product.reference_images : undefined,
          reference_image: product.reference_images?.[0],
        })),
      requested_ratios: selectedRatios,
      image_model: selectedModel,
      video_model: outputType === "video" ? selectedModel : undefined,
      brand: {
        primary_color: brandColors[0] || "#000000",
        font_family: fontFamily,
        logo_required: logoRequired,
        logo_safe_zone_percent: 4,
      },
      compliance_mode: complianceMode,
      output_type: outputType,
    };
    onGenerate(brief);
  };

  const downloadExampleBrief = () => {
    const exampleProfile = BUILTIN_BRAND_PROFILES.novapop;
    const exampleBrief = {
      brand_name: exampleProfile.name,
      campaign_id: exampleProfile.defaults.campaignId,
      message: exampleProfile.defaults.message,
      overlay_text: exampleProfile.defaults.overlayText,
      markets: ["US"],
      audience: exampleProfile.defaults.audience,
      languages: ["en"],
      products: cloneProducts(exampleProfile.defaults.products).map((product) => ({
        id: product.id,
        name: product.name,
        tagline: product.tagline,
      })),
      requested_ratios: ["1:1", "4:5", "728x90"],
      image_model: "flux.1-dev",
      brand: {
        primary_color: exampleProfile.defaults.brandColors[0],
        font_family: exampleProfile.defaults.fontFamily,
        logo_required: true,
        logo_safe_zone_percent: 4,
      },
      compliance_mode: "strict",
      output_type: "image",
    };
    const blob = new Blob([JSON.stringify(exampleBrief, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "novapop-example-brand-profile.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const currentLogo = logos[activeBrand];

  return (
    <Card className="flex flex-col overflow-y-auto max-h-[calc(100vh-5rem)]">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-display flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Campaign Brief
          </CardTitle>
          <div className="flex items-center gap-2">
            <input
              ref={briefUploadRef}
              type="file"
              accept=".json,.yaml,.yml"
              onChange={handleBriefUpload}
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => briefUploadRef.current?.click()}
            >
              <FileUp className="h-3 w-3 mr-1" />
              Upload JSON / YAML
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={downloadExampleBrief}
            >
              <Download className="h-3 w-3 mr-1" />
              Download Example
            </Button>
            <Badge className={`bg-gradient-to-r ${brand.theme} border-0 text-primary-foreground text-[10px]`}>
              {brand.name}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 flex-1 text-sm">
        {/* Brand Selector */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Brand Profile
          </label>
          <Select value={activeBrand} onValueChange={setActiveBrand}>
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(allBrandProfiles).map(([key, profile]) => (
                <SelectItem key={key} value={key}>
                  {profile.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Logo Upload */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Brand Logo
          </label>
          <input
            ref={logoInputRef}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            onChange={handleLogoUpload}
            className="hidden"
          />
          {currentLogo ? (
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-md border border-border bg-muted flex items-center justify-center overflow-hidden">
                <img src={currentLogo} alt="Logo" className="h-full w-full object-contain" />
              </div>
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className="text-[11px] text-primary hover:underline"
              >
                Replace
              </button>
              <button
                type="button"
                onClick={removeLogo}
                className="text-[11px] text-muted-foreground hover:text-destructive"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-dashed border-input text-xs text-muted-foreground hover:border-primary hover:text-foreground transition-colors w-full"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload logo
            </button>
          )}
        </div>

        {/* Campaign ID */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Campaign ID
          </label>
          <Input value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="h-7 text-xs" />
        </div>

        {/* Message */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Campaign Message / Prompt
          </label>
          <textarea
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-ring min-h-[60px] text-foreground"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
        </div>

        {/* Overlay Text */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Overlay Text (displayed on image)
          </label>
          <textarea
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-ring min-h-[40px] text-foreground"
            value={overlayText}
            onChange={(e) => setOverlayText(e.target.value)}
            placeholder="Text to display on the final image"
          />
        </div>

        {/* Market & Language multi-select dropdowns */}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Markets</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full h-8 justify-between text-xs font-normal">
                  <span className="truncate">
                    {markets.length === 0
                      ? "Select markets…"
                      : markets.length === 1
                      ? AVAILABLE_MARKETS.find((m) => m.value === markets[0])?.label
                      : `${markets.length} selected`}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-0" align="start">
                <div className="max-h-60 overflow-y-auto p-1">
                  {AVAILABLE_MARKETS.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() =>
                        setMarkets((prev) =>
                          prev.includes(m.value) ? prev.filter((v) => v !== m.value) : [...prev, m.value]
                        )
                      }
                      className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors text-left"
                    >
                      <div
                        className={`h-3.5 w-3.5 rounded-sm border flex items-center justify-center ${
                          markets.includes(m.value) ? "bg-primary border-primary" : "border-input"
                        }`}
                      >
                        {markets.includes(m.value) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                      </div>
                      {m.label}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Languages</label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full h-8 justify-between text-xs font-normal">
                  <span className="truncate">
                    {languages.length === 0
                      ? "Select languages…"
                      : languages.length === 1
                      ? AVAILABLE_LANGUAGES.find((l) => l.value === languages[0])?.label
                      : `${languages.length} selected`}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-50 shrink-0" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-48 p-0" align="start">
                <div className="max-h-60 overflow-y-auto p-1">
                  {AVAILABLE_LANGUAGES.map((l) => (
                    <button
                      key={l.value}
                      type="button"
                      onClick={() =>
                        setLanguages((prev) =>
                          prev.includes(l.value) ? prev.filter((v) => v !== l.value) : [...prev, l.value]
                        )
                      }
                      className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors text-left"
                    >
                      <div
                        className={`h-3.5 w-3.5 rounded-sm border flex items-center justify-center ${
                          languages.includes(l.value) ? "bg-primary border-primary" : "border-input"
                        }`}
                      >
                        {languages.includes(l.value) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                      </div>
                      {l.label}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Audience</label>
          <Input value={audience} onChange={(e) => setAudience(e.target.value)} className="h-7 text-xs" />
        </div>

        {/* Products */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Products</label>
            <button type="button" onClick={addProduct} className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
              <Plus className="h-3 w-3" /> Add
            </button>
          </div>
          <div className="space-y-1.5">
            {products.map((p, i) => (
              <div key={`${p.id}-${i}`} className="rounded-md border border-border p-2 space-y-2">
                <div className="flex gap-2 items-start">
                  <div className="flex-1 space-y-1">
                    <Input value={p.name} onChange={(e) => updateProduct(i, "name", e.target.value)} placeholder="Product name" className="h-7 text-xs" />
                    <Input value={p.tagline || ""} onChange={(e) => updateProduct(i, "tagline", e.target.value)} placeholder="Tagline (optional)" className="h-7 text-xs" />
                  </div>
                  {products.length > 1 && (
                    <button type="button" onClick={() => removeProduct(i)} className="mt-1 p-1 text-muted-foreground hover:text-destructive transition-colors">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      Selected References (up to {MAX_REFERENCE_IMAGE_COUNT})
                    </label>
                    {(p.reference_images?.length ?? 0) > 0 ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-5 gap-2">
                          {(p.reference_images ?? []).map((img, idx) => (
                            <div key={idx} className="relative group">
                              <div className="h-14 w-full rounded-md border border-border bg-muted overflow-hidden flex items-center justify-center">
                                <img src={img} alt={`${p.name || "Product"} reference ${idx + 1}`} className="h-full w-full object-contain" />
                              </div>
                              <button
                                type="button"
                                onClick={() => removeReferenceImage(i, idx)}
                                className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-input px-3 py-2 text-[11px] text-muted-foreground">
                        No references selected yet.
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        Brand Media Library
                      </label>
                      <span className="text-[10px] text-muted-foreground">
                        {loadingMediaLibrary ? "Loading..." : `${currentMediaLibrary.length} items`}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLibraryModalProductIndex(i)}
                      className="flex items-center justify-between gap-2 rounded-md border border-input px-3 py-2 text-xs text-muted-foreground hover:border-primary hover:text-foreground transition-colors w-full"
                    >
                      <span>Browse all brand library images</span>
                      <span className="text-[10px]">{currentMediaLibrary.length}</span>
                    </button>
                  </div>

                  <input
                    ref={(element) => {
                      productRefInputRefs.current[p.id || `product_${i + 1}`] = element;
                    }}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    onChange={(e) => handleRefImageUpload(i, e)}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => productRefInputRefs.current[p.id || `product_${i + 1}`]?.click()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-dashed border-input text-xs text-muted-foreground hover:border-primary hover:text-foreground transition-colors w-full"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Upload image and add to this brand library
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <Dialog open={libraryModalProductIndex !== null} onOpenChange={(open) => !open && setLibraryModalProductIndex(null)}>
          <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Brand Media Library</DialogTitle>
              <DialogDescription>
                {activeLibraryProduct
                  ? `Add references for ${activeLibraryProduct.name || "this product"} from the ${brand.name} library.`
                  : `Browse all media in the ${brand.name} library.`}
              </DialogDescription>
            </DialogHeader>
            {currentMediaLibrary.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {currentMediaLibrary.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (libraryModalProductIndex !== null) {
                        void addLibraryItemToProduct(libraryModalProductIndex, item);
                      }
                    }}
                    className="group text-left"
                    title={`Add ${item.name}`}
                  >
                    <div className="h-28 w-full rounded-md border border-border bg-muted overflow-hidden flex items-center justify-center group-hover:border-primary transition-colors">
                      <img src={item.url} alt={item.name} className="h-full w-full object-contain" />
                    </div>
                    <p className="mt-1 truncate text-[11px] text-foreground">{item.name}</p>
                    {item.product_id && (
                      <p className="truncate text-[10px] text-muted-foreground">{item.product_id}</p>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-input px-3 py-8 text-sm text-muted-foreground text-center">
                No media library items for this brand yet.
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Sizes */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Output Size</label>
          <div className="flex flex-wrap gap-1">
            {AVAILABLE_RATIOS.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => toggleRatio(r.value)}
                className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors ${
                  selectedRatios.includes(r.value)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-input hover:border-primary"
                }`}
                title={r.desc}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Brand Colors - 5 swatches */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Brand Colors</label>
          <div className="flex items-center gap-1.5">
            {brandColors.map((color, i) => (
              <div key={i} className="relative group">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => updateBrandColor(i, e.target.value)}
                  className="h-7 w-7 rounded border border-input cursor-pointer appearance-none"
                  style={{ backgroundColor: color }}
                  title={`Color ${i + 1}: ${color}`}
                />
                <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[8px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  {color}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Font + Logo checkbox */}
        <div className="flex items-center gap-3">
          <Input value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} placeholder="Font family" className="h-7 text-xs flex-1" />
          <div className="flex items-center gap-1.5 shrink-0">
            <Checkbox checked={logoRequired} onCheckedChange={(v) => setLogoRequired(v === true)} id="logo-req" />
            <label htmlFor="logo-req" className="text-[10px] text-muted-foreground cursor-pointer">Logo req.</label>
          </div>
        </div>

        {/* Output Type */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Output Type</label>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setOutputType("image")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium border transition-colors ${
                outputType === "image"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-input hover:border-primary"
              }`}
            >
              <ImageIcon className="h-3.5 w-3.5" /> Image
            </button>
            <button
              type="button"
              onClick={() => setOutputType("video")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium border transition-colors ${
                outputType === "video"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-input hover:border-primary"
              }`}
            >
              <Video className="h-3.5 w-3.5" /> Video (5s)
            </button>
          </div>
        </div>

        {/* Compliance Mode */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Compliance</label>
          <Select value={complianceMode} onValueChange={(v) => setComplianceMode(v as "strict" | "advisory")}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="strict">Strict</SelectItem>
              <SelectItem value="advisory">Advisory</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-1">
          <Select value={selectedModel} onValueChange={setSelectedModel}>
            <SelectTrigger className="h-9 text-xs w-full min-w-0">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {availableModels.map((m) => (
                <SelectItem key={m.value} value={m.value} textValue={m.label}>
                  <div className="flex flex-col">
                    <span className="text-xs font-medium">{m.label}</span>
                    <span className="text-[10px] text-muted-foreground">{m.desc}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            className={`w-full font-display font-semibold ${brand.buttonClass}`}
            size="sm"
            onClick={handleSubmit}
            disabled={isGenerating || !products.some((p) => p.name.trim()) || selectedRatios.length === 0}
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating… {progress > 0 && `${progress}%`}
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default CampaignBriefForm;
