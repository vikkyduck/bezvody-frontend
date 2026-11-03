import { readFile, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { readBranding, readPublications, readPublicationSidecar, readPublicHtmlFiles, brandElements, brandPublication, headParts, headTags, projectRoot } from "./brand-publications.mjs"

const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex")
const brand = await readBranding()
check(brand.origin === "https://nowater.tech", "Brand origin must remain https://nowater.tech")
check(brand.siteName === "БЕЗ ВОДЫ", "Brand site name must remain БЕЗ ВОДЫ")
check(typeof brand.version === "string" && brand.version.length > 0, "Brand version is required")
check(brand.shareImageWidth === 1200 && brand.shareImageHeight === 630, "Social preview must declare the 1200x630 brand image")

function assetFile(href) {
  check(typeof href === "string" && href.startsWith("/") && !href.startsWith("//"), `Brand asset must use a site-root path: ${href}`)
  const url = new URL(href, brand.origin)
  check(url.origin === brand.origin, `Brand asset must stay on nowater.tech: ${href}`)
  return resolve(projectRoot, "public", "." + url.pathname)
}

const keys = ["sourceLogo", "faviconSvg", "faviconIco", "icon32", "appleTouchIcon", "manifest", "shareImage"]
for (const key of keys) {
  try {
    check((await stat(assetFile(brand[key]))).size > 0, `Brand asset is empty: ${key}`)
  } catch {
    check(false, `Brand asset is missing: ${key}`)
  }
}

const sourceFile = assetFile(brand.sourceLogo)
const approvedSourceSha256 = "97c91f044a1045eab29748426af2a2f6c00d5ac96836a90d02c4b678a316e586"
check(sha256(await readFile(sourceFile)) === approvedSourceSha256, "Source logo differs from the user-approved original")

const ico = await readFile(assetFile(brand.faviconIco))
check(ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1 && ico.readUInt16LE(4) > 0, "Fallback favicon must be a valid ICO container")
check(sha256(ico) !== "dd821076a9b03adc2173c93956226aea3d92482d7578fc4339c5d3a2e9c24586", "Fallback favicon must not be the legacy Lovable asset")
check((await readFile(resolve(projectRoot, "public/favicon.ico"))).equals(ico), "Root fallback favicon.ico must match the canonical ICO")
const svg = await readFile(assetFile(brand.faviconSvg), "utf8")
check(svg.includes("<svg") && !/lovable|талисман|mascot|Кот-росчерк/i.test(svg), "SVG favicon must use the approved logo, not a provider or mascot")
check((await readFile(resolve(projectRoot, "public/favicon.svg"), "utf8")) === svg, "Root fallback favicon.svg must match the canonical SVG")

const webmanifest = JSON.parse(await readFile(assetFile(brand.manifest), "utf8"))
check(!/lovable/i.test(JSON.stringify(webmanifest)), "Web manifest must not contain provider branding")
check(Array.isArray(webmanifest.icons) && webmanifest.icons.length >= 2, "Web manifest must supply phone/bookmark icons")
for (const icon of webmanifest.icons ?? []) {
  check(typeof icon.src === "string" && !/lovable/i.test(icon.src), "Manifest contains a legacy provider icon")
  check(icon.type === "image/png" && ["192x192", "512x512"].includes(icon.sizes), "Manifest icons must declare the supported PNG dimensions")
  try { check((await stat(assetFile(icon.src))).size > 0, `Manifest icon missing: ${icon.src}`) }
  catch { check(false, `Manifest icon missing: ${icon.src}`) }
}

function pngDimensions(bytes) {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return null
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`
}
for (const [key, dimensions] of [["icon32", "32x32"], ["appleTouchIcon", "180x180"], ["shareImage", "1200x630"]]) {
  check(pngDimensions(await readFile(assetFile(brand[key]))) === dimensions, `${key} PNG dimensions must be ${dimensions}`)
}
for (const icon of webmanifest.icons ?? []) {
  check(pngDimensions(await readFile(assetFile(icon.src))) === icon.sizes, `Manifest icon bytes do not match declared size: ${icon.src}`)
}

// All surfaces must use the same configuration and common application head.
const rootSource = await readFile(resolve(projectRoot, "src/routes/__root.tsx"), "utf8")
const fatalSource = await readFile(resolve(projectRoot, "src/lib/error-page.ts"), "utf8")
const sharedSource = await readFile(resolve(projectRoot, "src/lib/brand-head.ts"), "utf8")
check(sharedSource.includes("branding.json"), "Application brand metadata must read the canonical branding.json")
check(rootSource.includes("brandLinks") && rootSource.includes("brandMeta"), "SSR root must use common brand links and metadata")
check(fatalSource.includes("renderBrandHeadHTML"), "Fatal fallback HTML must use the common brand head")
check(!/rel:\s*["']icon["'][\s\S]{0,120}href:\s*["']\/favicon\.svg["']/.test(rootSource), "SSR root still selects the old standalone favicon")

const expected = brandElements(brand)
const publications = await readPublications()
function checkPageHead(html, source, url) {
  const tags = headTags(headParts(html).head)
  const links = tags.filter(tag => tag.name === "link")
  const meta = tags.filter(tag => tag.name === "meta")
  for (const expectedLink of expected.links) {
    const matches = links.filter(tag => Object.entries(expectedLink).every(([key, value]) => tag.attributes[key] === String(value)))
    check(matches.length === 1, `${source}: expected exactly one canonical ${expectedLink.rel}/${expectedLink.type ?? "default"} link`)
  }
  for (const expectedMeta of expected.meta) {
    const key = expectedMeta.property ?? expectedMeta.name
    const matches = meta.filter(tag => (tag.attributes.property ?? tag.attributes.name) === key)
    check(matches.length === 1 && matches[0].attributes.content === String(expectedMeta.content), `${source}: ${key} must select the canonical brand value once`)
  }
  const managed = links.filter(tag => /(?:^|\s)(?:icon|apple-touch-icon|manifest)(?:\s|$)/i.test(tag.attributes.rel ?? ""))
  check(managed.length === expected.links.length, `${source}: unexpected icon/manifest link remains`)
  check(brandPublication(html, brand, url) === html, `${source}: publication branding is not normalized`)
}
for (const report of publications) {
  const html = await readFile(report.file, "utf8")
  checkPageHead(html, report.source, report.url)
  check(report.branding_version === brand.version, `${report.source}: manifest brand version is stale`)
  check(report.sha256 === sha256(Buffer.from(html)), `${report.source}: publication SHA-256 is stale`)
  const sidecar = await readPublicationSidecar(report)
  if (sidecar) {
    check(sidecar.metadata.report_sha256 === report.sha256, `${report.source}: sidecar SHA-256 is stale`)
    check(sidecar.metadata.branding_version === brand.version, `${report.source}: sidecar brand version is stale`)
  }
}
const publicPages = await readPublicHtmlFiles(projectRoot, brand.origin)
for (const page of publicPages) checkPageHead(await readFile(page.file, "utf8"), page.source, page.url)

const nginx = await readFile(resolve(projectRoot, "deploy/nginx-nowater-ai-radar.conf"), "utf8")
const aliases = [...nginx.matchAll(/\balias\s+([^;\s]+\.html)\s*;/g)].map(match => match[1])
for (const alias of aliases) check(publications.some(report => report.remote_file === alias), `Published nginx report alias is not registered: ${alias}`)
for (const report of publications) check(aliases.includes(report.remote_file), `Report has no corresponding nginx alias: ${report.source}`)

const generator = await readFile(resolve(projectRoot, "reports/avito-goods-2026-11-03/build-web.py"), "utf8")
check(generator.includes("brand-publications.mjs") && generator.includes("--stdin"), "Report generator must pass new HTML through shared branding")

if (failures.length) {
  console.error(failures.map(message => `Branding check failed: ${message}`).join("\n"))
  process.exitCode = 1
} else {
  console.log(`Branding verified: shared SSR/fallback metadata, ${publications.length} published reports, ${publicPages.length} standalone public HTML pages, canonical logo, desktop/phone icons and social preview`)
}
