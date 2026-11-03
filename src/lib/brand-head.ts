import branding from "../../branding.json";

const shareImage = new URL(branding.shareImage, branding.origin).href;

export const brandLinks = [
  { rel: "icon", href: branding.faviconSvg, type: "image/svg+xml", sizes: "any" },
  { rel: "icon", href: branding.icon32, type: "image/png", sizes: "32x32" },
  { rel: "shortcut icon", href: branding.faviconIco, type: "image/x-icon" },
  { rel: "apple-touch-icon", href: branding.appleTouchIcon, sizes: "180x180" },
  { rel: "manifest", href: branding.manifest },
] as const;

export const brandMeta = [
  { name: "theme-color", content: branding.themeColor },
  { property: "og:site_name", content: branding.siteName },
  { property: "og:image", content: shareImage },
  { property: "og:image:width", content: String(branding.shareImageWidth) },
  { property: "og:image:height", content: String(branding.shareImageHeight) },
  { property: "og:image:alt", content: branding.siteName },
  { name: "twitter:card", content: "summary_large_image" },
  { name: "twitter:image", content: shareImage },
  { name: "twitter:image:alt", content: branding.siteName },
] as const;

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

function attributes(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([name, value]) => `${name}="${escapeAttribute(value)}"`)
    .join(" ");
}

// The fatal HTML response does not pass through the router's root head.
export function renderBrandHeadHTML(): string {
  return [
    ...brandLinks.map((link) => `<link ${attributes(link)} />`),
    ...brandMeta.map((meta) => `<meta ${attributes(meta)} />`),
  ].join("\n    ");
}
