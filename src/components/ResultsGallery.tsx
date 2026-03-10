import { useState, type CSSProperties } from "react";
import { CheckCircle2, XCircle, AlertTriangle, Download, Trash2, FileDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { GenerationManifest, VariantResult, ComplianceCheck } from "@/types/campaign";
import { fetchAssetBlob } from "@/lib/assetFetch";

interface ResultsGalleryProps {
  manifest: GenerationManifest | null;
  isGenerating: boolean;
  progress: number;
  placeholderCount?: number;
  onClearGallery?: () => void;
  onDeleteVariant?: (index: number) => void;
  headerOnly?: boolean;
}

const statusIcon = (status: ComplianceCheck["status"]) => {
  switch (status) {
    case "pass":
      return <CheckCircle2 className="h-3 w-3 text-emerald-500" />;
    case "fail":
      return <XCircle className="h-3 w-3 text-destructive" />;
    case "flag":
      return <AlertTriangle className="h-3 w-3 text-amber-500" />;
  }
};

const statusColor = (status: ComplianceCheck["status"]) => {
  switch (status) {
    case "pass":
      return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20";
    case "fail":
      return "bg-destructive/10 text-destructive border-destructive/20";
    case "flag":
      return "bg-amber-500/10 text-amber-700 border-amber-500/20";
  }
};

const parseAspectDimensions = (ratio: string): { w: number; h: number } => {
  const pixelMatch = ratio.match(/^(\d+)x(\d+)$/i);
  if (pixelMatch) {
    return {
      w: Number(pixelMatch[1]),
      h: Number(pixelMatch[2]),
    };
  }

  const ratioMatch = ratio.match(/^(\d+):(\d+)$/);
  if (ratioMatch) {
    return {
      w: Number(ratioMatch[1]),
      h: Number(ratioMatch[2]),
    };
  }

  return { w: 1, h: 1 };
};

const getPreviewLayout = (
  ratio: string,
): {
  cardClassName: string;
  frameClassName: string;
  frameStyle: CSSProperties;
  mediaClassName: string;
} => {
  const { w, h } = parseAspectDimensions(ratio);
  const aspectValue = w / h;

  if (aspectValue >= 4) {
    return {
      cardClassName: "w-full max-w-[30rem] justify-self-center",
      frameClassName: "overflow-hidden bg-muted",
      frameStyle: { aspectRatio: `${w} / ${h}` },
      mediaClassName: "h-full w-full object-contain",
    };
  }

  if (aspectValue <= 0.65) {
    return {
      cardClassName: "w-full max-w-[22rem] justify-self-center",
      frameClassName: "overflow-hidden bg-muted",
      frameStyle: { aspectRatio: `${w} / ${h}`, maxHeight: "28rem" },
      mediaClassName: "h-full w-full object-contain",
    };
  }

  return {
    cardClassName: "w-full",
    frameClassName: "overflow-hidden bg-muted",
    frameStyle: { aspectRatio: `${w} / ${h}` },
    mediaClassName: "h-full w-full object-contain",
  };
};

const handleDownload = async (imageUrl: string, fileName: string) => {
  try {
    const blob = await fetchAssetBlob(imageUrl);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    toast.error("Download failed");
  }
};

const VariantCard = ({
  variant,
  onDelete,
}: {
  variant: VariantResult;
  onDelete?: () => void;
}) => {
  const fileName = `${variant.product_id}_${variant.aspect_ratio.replace(":", "x")}.png`;
  const previewLayout = getPreviewLayout(variant.aspect_ratio);

  const isVideo = variant.media_type === "video";

  return (
    <div className={`rounded-xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-lg transition-shadow group ${previewLayout.cardClassName}`}>
      <div className="relative">
        <div className={previewLayout.frameClassName} style={previewLayout.frameStyle}>
          {isVideo ? (
            <video
              src={variant.image_url}
              className={previewLayout.mediaClassName}
              controls
              muted
              loop
              playsInline
              preload="metadata"
            />
          ) : (
            <img
              src={variant.image_url}
              alt={`${variant.product_name} — ${variant.aspect_ratio}`}
              className={previewLayout.mediaClassName}
            />
          )}
        </div>
        {onDelete && (
          <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={onDelete}
              className="p-1.5 rounded-full bg-background/80 backdrop-blur-sm hover:bg-destructive/20 transition-colors"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        )}
      </div>
      <div className="px-2 py-1.5 space-y-1">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <span className="text-[10px] font-medium text-foreground truncate">{variant.product_name}</span>
            <span className="text-[9px] text-muted-foreground shrink-0">{variant.aspect_ratio}</span>
            {isVideo && <span className="text-[8px] font-medium text-primary shrink-0">VID</span>}
            {variant.market && (
              <span className="text-[8px] text-muted-foreground shrink-0 bg-muted px-1 rounded">{variant.market}</span>
            )}
            {variant.language && variant.language !== "en" && (
              <span className="text-[8px] text-muted-foreground shrink-0 bg-muted px-1 rounded">{variant.language.toUpperCase()}</span>
            )}
          </div>
          <button
            onClick={() => handleDownload(variant.image_url, fileName)}
            className="p-1 rounded-md hover:bg-muted transition-colors shrink-0"
            title="Download"
          >
            <Download className="h-3 w-3 text-muted-foreground" />
          </button>
        </div>
        {variant.model_used && (
          <p className="text-[9px] text-muted-foreground">Model: {variant.model_used}</p>
        )}
        {variant.prompt && (
          <p className="text-[9px] text-muted-foreground leading-tight line-clamp-2" title={variant.prompt}>
            {variant.prompt}
          </p>
        )}
        {variant.compliance.length > 0 && (
          <div className="flex flex-wrap gap-0.5">
            {variant.compliance.map((c, i) => (
              <div
                key={i}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] ${statusColor(c.status)}`}
                title={c.details}
              >
                {statusIcon(c.status)}
                <span className="font-medium">{c.check}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const LoadingCard = () => (
  <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
    <div className="aspect-square bg-muted animate-pulse" />
    <div className="px-2 py-1.5 space-y-1">
      <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
      <div className="h-2.5 w-1/2 rounded bg-muted animate-pulse" />
    </div>
  </div>
);

const uniqueValues = (values: Array<string | undefined>) =>
  Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));

const ResultsGallery = ({
  manifest,
  isGenerating,
  placeholderCount = 0,
  onClearGallery,
  onDeleteVariant,
  headerOnly,
}: ResultsGalleryProps) => {
  const [brandFilter, setBrandFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const handleDelete = (_variant: VariantResult, index: number) => {
    onDeleteVariant?.(index);
    toast.success("Image deleted");
  };

  const hasVariants = Boolean(manifest && manifest.variants.length > 0);
  if (!hasVariants && placeholderCount === 0) return null;

  if (headerOnly) {
    if (!manifest) return null;
    const exportReport = () => {
      const json = JSON.stringify(manifest, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${manifest.campaign_id}_report.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Report downloaded");
    };

    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge variant="outline" className="text-[10px]">
          {manifest.total_variants} variant{manifest.total_variants !== 1 ? "s" : ""}
        </Badge>
        <Badge variant="outline" className="text-[10px] hidden sm:inline-flex">
          {manifest.compliance_mode}
        </Badge>
        <Button variant="ghost" size="sm" onClick={exportReport} className="h-6 px-2 text-[10px] text-muted-foreground" title="Export report as JSON">
          <FileDown className="h-3 w-3 mr-1" /> <span className="hidden sm:inline">Report</span>
        </Button>
        {onClearGallery && (
          <Button variant="ghost" size="sm" onClick={onClearGallery} className="h-6 px-2 text-[10px] text-muted-foreground">
            <Trash2 className="h-3 w-3 mr-1" /> <span className="hidden sm:inline">Clear</span>
          </Button>
        )}
      </div>
    );
  }

  const variants = manifest?.variants ?? [];
  const brandOptions = uniqueValues(variants.map((variant) => variant.brand_name));
  const productOptions = uniqueValues(variants.map((variant) => variant.product_name));
  const sizeOptions = uniqueValues(variants.map((variant) => variant.aspect_ratio));
  const modelOptions = uniqueValues(variants.map((variant) => variant.model_used));
  const hasFilters = brandOptions.length > 1 || productOptions.length > 1 || sizeOptions.length > 1 || modelOptions.length > 1;

  const filteredVariants = variants.filter((variant) => {
    if (brandFilter !== "all" && variant.brand_name !== brandFilter) return false;
    if (productFilter !== "all" && variant.product_name !== productFilter) return false;
    if (sizeFilter !== "all" && variant.aspect_ratio !== sizeFilter) return false;
    if (modelFilter !== "all" && variant.model_used !== modelFilter) return false;
    return true;
  });

  return (
    <div className="space-y-3">
      {hasFilters && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            <Select value={brandFilter} onValueChange={setBrandFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All brands" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All brands</SelectItem>
                {brandOptions.map((brand) => (
                  <SelectItem key={brand} value={brand}>
                    {brand}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={productFilter} onValueChange={setProductFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All products" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All products</SelectItem>
                {productOptions.map((product) => (
                  <SelectItem key={product} value={product}>
                    {product}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sizeFilter} onValueChange={setSizeFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All sizes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sizes</SelectItem>
                {sizeOptions.map((size) => (
                  <SelectItem key={size} value={size}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={modelFilter} onValueChange={setModelFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All models" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All models</SelectItem>
                {modelOptions.map((model) => (
                  <SelectItem key={model} value={model}>
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[10px]">
              Showing {filteredVariants.length} of {variants.length}
            </Badge>
            {(brandFilter !== "all" || productFilter !== "all" || sizeFilter !== "all" || modelFilter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-muted-foreground"
                onClick={() => {
                  setBrandFilter("all");
                  setProductFilter("all");
                  setSizeFilter("all");
                  setModelFilter("all");
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredVariants.map((v, i) => {
          const realIndex = variants.indexOf(v);
          return (
            <VariantCard
              key={`${v.product_id}-${v.aspect_ratio}-${i}`}
              variant={v}
              onDelete={onDeleteVariant ? () => handleDelete(v, realIndex) : undefined}
            />
          );
        })}
        {isGenerating &&
          Array.from({ length: placeholderCount }, (_, index) => <LoadingCard key={`loading-${index}`} />)}
      </div>

      {filteredVariants.length === 0 && !isGenerating && (
        <div className="rounded-lg border border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
          No results match the current filters.
        </div>
      )}

      {manifest?.errors && manifest.errors.length > 0 && (
        <div className="p-3 rounded-lg border border-destructive/20 bg-destructive/5">
          <p className="text-xs font-medium text-destructive mb-1">Generation Errors</p>
          {manifest.errors.map((err, i) => (
            <p key={i} className="text-[11px] text-muted-foreground">{err}</p>
          ))}
        </div>
      )}
    </div>
  );
};

export default ResultsGallery;
