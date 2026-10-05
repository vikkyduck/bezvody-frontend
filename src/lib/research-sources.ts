export function sourceLink(title: string, url: string): string {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) return "";
    const label = title.replace(/[\[\]\\\r\n]/g, " ").replace(/\|/g, "\\|") || u.hostname;
    return `[${label}](<${u.href.replace(/[<>]/g, "")}>)`;
  } catch {
    return "";
  }
}

export function anthropicText(blocks: Array<unknown>): string {
  return blocks
    .flatMap((b) => {
      const block = b as {
        type?: string;
        text?: string;
        citations?: Array<{ type?: string; url?: string; title?: string }>;
      };
      if (block.type !== "text") return [];
      const links = [
        ...new Set(
          (block.citations ?? [])
            .flatMap((c) => (c.url ? [sourceLink(c.title ?? "Источник", c.url)] : []))
            .filter(Boolean),
        ),
      ];
      return [`${block.text ?? ""}${links.length ? ` ${links.join(" ")}` : ""}`];
    })
    .join("\n")
    .trim();
}
