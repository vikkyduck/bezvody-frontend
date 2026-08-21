/**
 * Распознавание офисных документов. Только сервер.
 *
 * Word, Excel и PowerPoint — это zip с XML внутри. Отдельной библиотеки для
 * этого не заводим: zip разбирается по спецификации, распаковка — встроенным
 * zlib. Меньше зависимостей — меньше поводов у сборки развалиться на выкатке.
 *
 * Задача скромная и честная: достать ТЕКСТ. Картинки, стили и формулы теряются;
 * агенту нужны слова и числа, а не оформление. PDF сюда не попадает — его
 * модель читает сама, целиком и с вёрсткой.
 */

export type ZipEntry = { name: string; size: number; read: () => Buffer };

/**
 * Сколько распакованного XML готовы держать в памяти.
 * Office-файл — это архив, и стомегабайтная книга разворачивается в гигабайты.
 * Лучше честно сказать «не осилили», чем уронить сервис всем сразу.
 */
const MAX_UNPACKED = 200 * 1024 * 1024;

// ── Zip ───────────────────────────────────────────────────────────────────────

/**
 * Разбираем через центральный каталог, а не по локальным заголовкам: в файлах
 * из Google Docs и из питоновских выгрузок размеры в локальном заголовке
 * бывают нулевыми (флаг data descriptor), и последовательный обход врёт.
 */
export async function openZip(buf: Buffer): Promise<Map<string, ZipEntry>> {
  const { inflateRawSync } = await import("node:zlib");
  const out = new Map<string, ZipEntry>();

  // Хвост с концом центрального каталога: 22 байта плюс комментарий до 64 КБ.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("не похоже на документ Office");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localAt = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    out.set(name, {
      name,
      size: rawSize,
      read: () => {
        if (rawSize > MAX_UNPACKED)
          throw new Error("файл слишком тяжёлый, чтобы разобрать его целиком");
        if (buf.readUInt32LE(localAt) !== 0x04034b50) throw new Error("битый документ");
        const dataAt =
          localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
        const raw = buf.subarray(dataAt, dataAt + compSize);
        return method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
      },
    });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const textOf = (zip: Map<string, ZipEntry>, name: string): string => {
  const e = zip.get(name);
  return e ? e.read().toString("utf8") : "";
};

// ── XML ───────────────────────────────────────────────────────────────────────

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]*>/g, ""));

/** Всё содержимое одноимённых тегов подряд: <w:t>, <a:t>, <t> — по вкусу вызова. */
function collect(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  for (const m of xml.matchAll(re)) out.push(decodeEntities(m[1] ?? ""));
  return out;
}

const tidy = (s: string) =>
  s
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// ── Word ──────────────────────────────────────────────────────────────────────

function fromDocx(zip: Map<string, ZipEntry>): string {
  const xml = textOf(zip, "word/document.xml");
  if (!xml) throw new Error("внутри нет текста документа");

  const flat = xml
    // Абзац, разрыв строки и табуляция — единственная разметка, которая
    // осмысленна в голом тексте: без неё таблица слипается в кашу.
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<\/w:tc>/g, "\t")
    .replace(/<\/w:tr>/g, "\n");

  return tidy(stripTags(flat));
}

// ── Excel ─────────────────────────────────────────────────────────────────────

/** Номер столбца из адреса ячейки: "AB12" → 27. Нужен, чтобы не съехали колонки. */
function colIndex(ref: string): number {
  const letters = (ref.match(/^[A-Z]+/) ?? [""])[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function sheetNames(zip: Map<string, ZipEntry>): { name: string; path: string }[] {
  const wb = textOf(zip, "xl/workbook.xml");
  const rels = textOf(zip, "xl/_rels/workbook.xml.rels");

  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*\/?>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1];
    const to = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && to) target.set(id, to.replace(/^\/?xl\//, "").replace(/^\.\//, ""));
  }

  const out: { name: string; path: string }[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = decodeEntities(/name="([^"]*)"/.exec(m[0])?.[1] ?? `Лист ${out.length + 1}`);
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1] ?? "";
    const path = `xl/${target.get(rid) ?? `worksheets/sheet${out.length + 1}.xml`}`;
    out.push({ name, path });
  }

  // Книга без внятной описи — берём листы по порядку файлов.
  if (!out.length) {
    for (const key of zip.keys()) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(key))
        out.push({ name: `Лист ${out.length + 1}`, path: key });
    }
  }
  return out;
}

const MAX_ROWS = 5000;

function fromXlsx(zip: Map<string, ZipEntry>): string {
  // Общая таблица строк: в ячейках лежат номера, а не сами слова.
  const shared = collect(textOf(zip, "xl/sharedStrings.xml"), "si").map((si) =>
    collect(si, "t").join(""),
  );

  const parts: string[] = [];
  for (const sheet of sheetNames(zip)) {
    const xml = textOf(zip, sheet.path);
    if (!xml) continue;

    const lines: string[] = [];
    let cut = false;
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (lines.length >= MAX_ROWS) {
        cut = true;
        break;
      }
      const cells: string[] = [];
      for (const c of (row[1] ?? "").matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = c[1] ?? "";
        const inner = c[2] ?? "";
        const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? "n";
        const at = colIndex(/r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? "");
        const v = collect(inner, "v")[0] ?? "";
        const value =
          type === "s"
            ? (shared[Number(v)] ?? "")
            : type === "inlineStr"
              ? collect(inner, "t").join("")
              : v;
        if (at >= 0) while (cells.length < at) cells.push("");
        cells.push(value.replace(/[\t\n]+/g, " ").trim());
      }
      const line = cells.join("\t").replace(/\t+$/, "");
      if (line.trim()) lines.push(line);
    }

    if (lines.length) {
      parts.push(
        `### ${sheet.name}\n${lines.join("\n")}${cut ? `\n… дальше ${MAX_ROWS}+ строк — обрезано` : ""}`,
      );
    }
  }

  if (!parts.length) throw new Error("в книге не нашлось заполненных ячеек");
  return tidy(parts.join("\n\n"));
}

// ── PowerPoint ────────────────────────────────────────────────────────────────

function fromPptx(zip: Map<string, ZipEntry>): string {
  const slides = [...zip.keys()]
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")));

  const parts: string[] = [];
  slides.forEach((path, i) => {
    const text = collect(textOf(zip, path), "a:t").join("\n").trim();
    if (text) parts.push(`### Слайд ${i + 1}\n${text}`);
  });

  if (!parts.length) throw new Error("в презентации не нашлось текста");
  return tidy(parts.join("\n\n"));
}

// ── Вход ──────────────────────────────────────────────────────────────────────

/** Достать текст из docx / xlsx / pptx. Бросает понятную ошибку, если не вышло. */
export async function officeText(name: string, bytes: Buffer): Promise<string> {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const zip = await openZip(bytes);
  if (ext === "docx") return fromDocx(zip);
  if (ext === "xlsx") return fromXlsx(zip);
  if (ext === "pptx") return fromPptx(zip);
  throw new Error("формат не поддержан");
}
