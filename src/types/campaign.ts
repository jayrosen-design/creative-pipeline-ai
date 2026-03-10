import type { ReferenceUsageMode } from "../../shared/imageModels";

export interface Product {
  id: string;
  name: string;
  tagline?: string;
  reference_images?: string[];
  reference_image?: string;
}

export interface Brand {
  primary_color: string;
  font_family: string;
  logo_required: boolean;
  logo_safe_zone_percent?: number;
}

export interface CampaignBrief {
  brand_name?: string;
  campaign_id: string;
  message: string;
  overlay_text: string;
  markets: string[];
  audience: string;
  languages: string[];
  products: Product[];
  requested_ratios: string[];
  image_model?: string;
  video_model?: string;
  brand: Brand;
  compliance_mode: "strict" | "advisory";
  output_type: "image" | "video";
  // Legacy single-value fields kept for backward compat
  market?: string;
  language?: string;
}

export interface ComplianceCheck {
  check: string;
  status: "pass" | "fail" | "flag";
  details: string;
}

export interface VariantResult {
  product_id: string;
  product_name: string;
  brand_name?: string;
  aspect_ratio: string;
  width?: number;
  height?: number;
  image_url: string;
  media_type?: "image" | "video";
  model_used?: string;
  reference_mode?: ReferenceUsageMode;
  reference_message?: string;
  reference_count?: number;
  prompt?: string;
  market?: string;
  language?: string;
  compliance: ComplianceCheck[];
}

export interface GenerationManifest {
  campaign_id: string;
  provider_used: string;
  compliance_mode: string;
  total_variants: number;
  total_errors: number;
  variants: VariantResult[];
  errors?: string[];
}
