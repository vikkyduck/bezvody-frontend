import { readFile, writeFile, readdir } from "node:fs/promises"
import { dirname, resolve, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { createHash } from "node:crypto"

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
export const brandStart = "<!-- NOWATER:BRAND:BEGIN -->"
export const brandEnd = "<!-- NOWATER:BRAND:END -->"

const escapeAttribute = value => String(value)
  .replaceAll("&", "&amp;").replaceAll('"', "&quot;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;")

const decodeEntities = value => value.replace(/&(?:#(x[\da-f]+|\d+)|amp|quot|apos|lt|gt);/gi, (entity, number) => {
  if (number) {
    const code = number[0].toLowerCase() === "x" ? parseInt(number.slice(1), 16) : Number(number)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
  }
  return { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" }[entity.toLowerCase()] ?? entity
})

export function attributes(tag) {
  const result = {}
  const body = tag.replace(/^<\/?[\w:-]+/, "").replace(/\/?\s*>$/, "")
  for (const match of body.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "")
  }
  return result
}

export function headParts(html) {
  const open = /<head\b[^>]*>/i.exec(html)
  if (!open) throw new Error("Publication must have an explicit head element")
  const start = open.index + open[0].length
  const close = /<\/head\s*>/i.exec(html.slice(start))
  if (!close) throw new Error("Publication has no closing head element")
  const end = start + close.index
  return { before: html.slice(0, start), head: html.slice(start, end), after: html.slice(end) }
}

// Skip comments and raw-text elements so CSS and scripts are never rewritten as tags.
export function headTags(head) {
  return [...head.matchAll(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<(?:[^>"']|"[^"]*"|'[^']*')*>/gi)]
    .filter(match => /^<(?:link|meta)\b/i.test(match[0]))
    .map(match => ({ text: match[0], index: match.index, name: /^<([\w:-]+)/.exec(match[0])[1].toLowerCase(), attributes: attributes(match[0]) }))
}

export async function readBranding(root = projectRoot) {
  return JSON.parse(await readFile(resolve(root, "branding.json"), "utf8"))
}

export function brandElements(brand) {
  const image = new URL(brand.shareImage, brand.origin).href
  return {
    links: [
      { rel: "icon", type: "image/svg+xml", sizes: "any", href: brand.faviconSvg },
      { rel: "icon", type: "image/png", sizes: "32x32", href: brand.icon32 },
      { rel: "shortcut icon", href: brand.faviconIco },
      { rel: "apple-touch-icon", sizes: "180x180", href: brand.appleTouchIcon },
      { rel: "manifest", href: brand.manifest },
    ],
    meta: [
      { name: "theme-color", content: brand.themeColor },
      { property: "og:site_name", content: brand.siteName },
      { property: "og:image", content: image },
      { property: "og:image:width", content: brand.shareImageWidth },
      { property: "og:image:height", content: brand.shareImageHeight },
      { property: "og:image:alt", content: brand.siteName },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:image", content: image },
      { name: "twitter:image:alt", content: brand.siteName },
    ],
  }
}

function serializeTag(name, values) {
  return `<${name} ${Object.entries(values).map(([key, value]) => `${key}="${escapeAttribute(value)}"`).join(" ")}>`
}

export function renderBrandHead(brand) {
  const { links, meta } = brandElements(brand)
  return [...links.map(value => serializeTag("link", value)), ...meta.map(value => serializeTag("meta", value))].join("\n")
}

const managedLink = rel => String(rel ?? "").toLowerCase().split(/\s+/).some(value => ["icon", "apple-touch-icon", "apple-touch-icon-precomposed", "mask-icon", "manifest", "fluid-icon", "apple-touch-startup-image"].includes(value))
const managedMeta = key => ["theme-color", "og:site_name", "og:image", "og:image:url", "og:image:secure_url", "og:image:width", "og:image:height", "og:image:type", "og:image:alt", "twitter:card", "twitter:image", "twitter:image:src", "twitter:image:alt"].includes(String(key ?? "").toLowerCase())

export function brandPublication(html, brand, url) {
  const parts = headParts(html)
  let head = parts.head.replace(/<!-- NOWATER:BRAND:BEGIN -->[\s\S]*?<!-- NOWATER:BRAND:END -->/g, "")
  const tags = headTags(head)
  const remove = tags.filter(tag => tag.name === "link" ? managedLink(tag.attributes.rel) : managedMeta(tag.attributes.property ?? tag.attributes.name))
  for (const tag of remove.reverse()) head = head.slice(0, tag.index) + head.slice(tag.index + tag.text.length)
  const remaining = headTags(head)
  const hasMeta = key => remaining.some(tag => tag.name === "meta" && (tag.attributes.property ?? tag.attributes.name)?.toLowerCase() === key)
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1]
  const description = remaining.find(tag => tag.name === "meta" && tag.attributes.name?.toLowerCase() === "description")?.attributes.content
  const pageTags = []
  if (!hasMeta("og:title") && title) pageTags.push({ property: "og:title", content: decodeEntities(title.replace(/<[^>]+>/g, "").trim()) })
  if (!hasMeta("og:description") && description) pageTags.push({ property: "og:description", content: description })
  if (!hasMeta("og:type")) pageTags.push({ property: "og:type", content: "article" })
  if (!hasMeta("og:url") && url) pageTags.push({ property: "og:url", content: new URL(url, brand.origin).href })
  const block = [brandStart, renderBrandHead(brand), ...pageTags.map(tag => serializeTag("meta", tag)), brandEnd].join("\n")
  return parts.before + head.trimEnd() + "\n" + block + "\n" + parts.after
}

export async function readPublications(root = projectRoot) {
  const manifest = JSON.parse(await readFile(resolve(root, "deploy/ai-radar-publications.json"), "utf8"))
  if (!Array.isArray(manifest.reports) || !manifest.reports.length) throw new Error("Publication manifest has no reports")
  const seen = new Set()
  return manifest.reports.map(report => {
    const file = resolve(root, report.source)
    if (!file.startsWith(root + "/") || !report.source.endsWith(".html")) throw new Error("Publication source must be an HTML file inside the project")
    if (seen.has(file)) throw new Error("Duplicate publication source")
    seen.add(file)
    return { ...report, file }
  })
}

export async function readPublicationSidecar(report) {
  const file = resolve(dirname(report.file), "publication.json")
  let metadata
  try { metadata = JSON.parse(await readFile(file, "utf8")) }
  catch (error) {
    if (error.code === "ENOENT") return null
    throw error
  }
  if (metadata.url !== report.url || typeof metadata.report_sha256 !== "string") {
    throw new Error(`Publication sidecar does not match its registered report: ${report.source}`)
  }
  return { file, metadata }
}

export async function readPublicHtmlFiles(root = projectRoot, origin = "https://nowater.tech") {
  const publicRoot = resolve(root, "public")
  const pages = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name)
      if (entry.isDirectory()) await walk(file)
      else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
        const pathname = "/" + relative(publicRoot, file).split("\\").join("/")
        pages.push({ file, source: relative(root, file), url: new URL(pathname.replace(/\/index\.html?$/i, "/"), origin).href })
      }
    }
  }
  await walk(publicRoot)
  return pages.sort((a, b) => a.source.localeCompare(b.source))
}

async function main() {
  const args = process.argv.slice(2)
  const brand = await readBranding()
  if (args[0] === "--stdin") {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    const urlIndex = args.indexOf("--url")
    process.stdout.write(brandPublication(Buffer.concat(chunks).toString("utf8"), brand, urlIndex < 0 ? undefined : args[urlIndex + 1]))
    return
  }
  if (args.length !== 1 || args[0] !== "--write") throw new Error("Usage: node scripts/brand-publications.mjs --write | --stdin [--url URL]")
  const reports = await readPublications()
  const manifestFile = resolve(projectRoot, "deploy/ai-radar-publications.json")
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"))
  for (const report of reports) {
    const html = await readFile(report.file, "utf8")
    const branded = brandPublication(html, brand, report.url)
    if (headParts(html).after !== headParts(branded).after) throw new Error("Publication body was unexpectedly modified")
    if (branded !== html) await writeFile(report.file, branded)
    const entry = manifest.reports.find(item => item.source === report.source)
    entry.sha256 = createHash("sha256").update(branded).digest("hex")
    entry.branding_version = brand.version
    const sidecar = await readPublicationSidecar(report)
    if (sidecar) {
      sidecar.metadata.report_sha256 = entry.sha256
      sidecar.metadata.branding_version = brand.version
      await writeFile(sidecar.file, JSON.stringify(sidecar.metadata, null, 2) + "\n")
    }
  }
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n")
  const publicPages = await readPublicHtmlFiles(projectRoot, brand.origin)
  for (const page of publicPages) {
    const html = await readFile(page.file, "utf8")
    const branded = brandPublication(html, brand, page.url)
    if (headParts(html).after !== headParts(branded).after) throw new Error("Public page body was unexpectedly modified")
    if (branded !== html) await writeFile(page.file, branded)
  }
  process.stdout.write(`Branded ${reports.length} registered publications and ${publicPages.length} standalone public HTML pages\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
