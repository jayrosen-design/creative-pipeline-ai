/**
 * Composites campaign message text onto a generated image using HTML Canvas.
 * Designed to look like an integrated part of the graphic design, not a label.
 * Returns a Blob of the composited PNG.
 */
import { fetchAssetBlob } from "@/lib/assetFetch";

export async function compositeTextOverlay(
  imageUrl: string,
  message: string,
  options?: {
    fontFamily?: string;
    brandColor?: string;
  }
): Promise<Blob> {
  const img = await loadImage(imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;

  // Draw original image
  ctx.drawImage(img, 0, 0);

  const W = canvas.width;
  const H = canvas.height;
  const brandColor = options?.brandColor || "#ffffff";
  const font = options?.fontFamily || "Arial";

  // --- Design-integrated overlay ---
  // Full-image cinematic color wash (brand-tinted)
  const { r, g, b } = hexToRgb(brandColor);

  // Subtle brand-tinted vignette over entire image
  const vignette = ctx.createRadialGradient(W * 0.5, H * 0.5, W * 0.2, W * 0.5, H * 0.5, W * 0.8);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, `rgba(0,0,0,0.35)`);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, W, H);

  // Bottom area: strong gradient that blends into the image
  const barHeight = Math.max(H * 0.32, 120);
  const bottomGrad = ctx.createLinearGradient(0, H - barHeight, 0, H);
  bottomGrad.addColorStop(0, "rgba(0,0,0,0)");
  bottomGrad.addColorStop(0.25, `rgba(${r},${g},${b},0.08)`);
  bottomGrad.addColorStop(0.5, `rgba(0,0,0,0.55)`);
  bottomGrad.addColorStop(1, `rgba(0,0,0,0.88)`);
  ctx.fillStyle = bottomGrad;
  ctx.fillRect(0, H - barHeight, W, barHeight);

  // Brand accent stripe — thin geometric element
  const stripeH = Math.max(3, H * 0.004);
  ctx.fillStyle = brandColor;
  ctx.globalAlpha = 0.85;
  const stripePad = W * 0.06;
  const stripeY = H - barHeight * 0.72;
  ctx.fillRect(stripePad, stripeY, W * 0.18, stripeH);
  ctx.globalAlpha = 1;

  // Text settings
  const padding = W * 0.06;
  const maxWidth = W - padding * 2;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "top";
  const textStartY = stripeY + stripeH + Math.max(H * 0.02, 8);
  const availableTextHeight = H - textStartY - Math.max(H * 0.06, 12);
  const { fontSize, lines, lineHeight } = computeTextLayout(
    ctx,
    message.toUpperCase(),
    maxWidth,
    availableTextHeight,
    font,
  );
  ctx.font = `800 ${fontSize}px "${font}", "Helvetica Neue", Arial, sans-serif`;
  ctx.letterSpacing = `${fontSize * 0.03}px`;

  // Draw each line with subtle shadow for depth
  ctx.shadowColor = `rgba(${r},${g},${b},0.4)`;
  ctx.shadowBlur = fontSize * 0.4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;

  lines.forEach((line, i) => {
    ctx.fillText(line, padding, textStartY + i * lineHeight);
  });

  // Reset shadow
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;

  // Small brand color dot/accent after text block
  const dotY = textStartY + lines.length * lineHeight + fontSize * 0.4;
  ctx.fillStyle = brandColor;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(padding + fontSize * 0.2, dotY, fontSize * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas toBlob failed"));
    }, "image/png");
  });
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  const num = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const blob = await fetchAssetBlob(url);
  const objectUrl = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load image"));
    };
    img.src = objectUrl;
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function truncateLineToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;

  let truncated = text;
  while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}…`;
}

function computeTextLayout(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  availableTextHeight: number,
  fontFamily: string,
): { fontSize: number; lines: string[]; lineHeight: number } {
  const minFontSize = Math.max(Math.min(maxWidth * 0.12, 16), 11);
  const maxFontSize = Math.max(Math.min(maxWidth * 0.22, 52), minFontSize);

  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 1) {
    ctx.font = `800 ${fontSize}px "${fontFamily}", "Helvetica Neue", Arial, sans-serif`;
    const lines = wrapText(ctx, text, maxWidth);
    const lineHeight = fontSize * 1.15;
    const maxLines = Math.max(3, Math.floor(availableTextHeight / lineHeight));

    if (lines.length <= maxLines) {
      return { fontSize, lines, lineHeight };
    }
  }

  const fallbackFontSize = minFontSize;
  ctx.font = `800 ${fallbackFontSize}px "${fontFamily}", "Helvetica Neue", Arial, sans-serif`;
  const lineHeight = fallbackFontSize * 1.15;
  const maxLines = Math.max(2, Math.floor(availableTextHeight / lineHeight));
  const wrapped = wrapText(ctx, text, maxWidth);
  const clipped = wrapped.slice(0, maxLines);

  if (wrapped.length > maxLines && clipped.length > 0) {
    clipped[clipped.length - 1] = truncateLineToWidth(ctx, clipped[clipped.length - 1], maxWidth);
  }

  return { fontSize: fallbackFontSize, lines: clipped, lineHeight };
}
