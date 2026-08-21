/**
 * Заполнение таблицы-шаблона. Только сервер.
 *
 * Счетовод не считает финмодель в уме — он заполняет поля готового шаблона,
 * а арифметику делает сам Excel по формулам, которые в шаблоне уже есть.
 * Так цифры сходятся с методикой компании, а не с тем, как модель сложила
 * числа в ответе. Заодно это проверяемо: видно, что подставлено руками,
 * а что посчиталось.
 *
 * Какие ячейки разрешено трогать, решает сам шаблон: в нём есть легенда
 * «синий текст — вводите руками», и мы читаем именно её — цвет шрифта.
 * Ячейку с формулой не трогаем никогда, даже если модель попросит: это
 * методика компании, ломать её мы права не имеем.
 *
 * Библиотеки для xlsx не заводим — в проекте zip уже разбирается своими
 * силами (server-office), здесь добавлена только запись.
 */
import { decodeEntities, openZip, type ZipEntry } from "./server-office";

/** Поле шаблона, которое человек (или агент) заполняет руками. */
export type SheetField = {
  sheet: string;
  /** Адрес ячейки: C6, D14 */
  ref: string;
  /** Подпись строки слева — «Клиентов в контуре, шт.» */
  label: string;
  /** Заголовок колонки, если таблица по столбцам — «Кв. 2» */
  column: string;
  /** Что стоит в шаблоне как пример: помогает понять единицы измерения */
  example: string;
  /** Подсказка справа — откуда брать значение */
  hint: string;
  /** Ключевое допущение: в шаблоне помечено жёлтым */
  key: boolean;
};

export type FilledCell = { sheet: string; ref: string; value: string };

const COL = (ref: string) => ref.replace(/\d+/g, "");
const ROW = (ref: string) => Number(ref.replace(/\D+/g, ""));

/** Номер колонки по буквам: A=1, B=2, AA=27 — для сортировки ячеек в строке. */
function colNum(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// ── Чтение книги ──────────────────────────────────────────────────────────────

type Sheet = { name: string; path: string; xml: string };

type Book = {
  zip: Map<string, ZipEntry>;
  sheets: Sheet[];
  shared: string[];
};

const attr = (tag: string, name: string): string =>
  decodeEntities(new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? "");

async function openBook(buf: Buffer): Promise<Book> {
  const zip = await openZip(buf);
  const read = (name: string) => zip.get(name)?.read().toString("utf8") ?? "";

  const shared: string[] = [];
  const sharedXml = read("xl/sharedStrings.xml");
  for (const m of sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push(
      [...(m[1] ?? "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
        .map((t) => decodeEntities(t[1] ?? ""))
        .join(""),
    );
  }

  // Имена листов лежат в workbook.xml, а файлы — через таблицу связей.
  const rels = read("xl/_rels/workbook.xml.rels");
  const relMap = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    relMap.set(attr(m[0], "Id"), attr(m[0], "Target"));
  }

  const sheets: Sheet[] = [];
  for (const m of read("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)) {
    const rid = attr(m[0], "r:id");
    const target = (relMap.get(rid) ?? "").replace(/^\//, "");
    const path = target.startsWith("xl/") ? target : `xl/${target}`;
    if (!zip.has(path)) continue;
    sheets.push({ name: attr(m[0], "name"), path, xml: read(path) });
  }

  return { zip, sheets, shared };
}

/** Значение ячейки как текст — для примера в карте полей. */
function cellText(cell: string, shared: string[]): string {
  const type = attr(cell, "t");
  if (type === "inlineStr") {
    return [...cell.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
      .map((t) => decodeEntities(t[1] ?? ""))
      .join("");
  }
  const v = /<v>([\s\S]*?)<\/v>/.exec(cell)?.[1];
  if (v === undefined) return "";
  if (type === "s") return shared[Number(v)] ?? "";
  return decodeEntities(v);
}

const hasFormula = (cell: string) => /<f[\s>]/.test(cell);

/**
 * Синий шрифт — метка «вводите руками» из легенды шаблона.
 *
 * Сравниваем не с конкретным кодом цвета: в шаблонах, пересохранённых через
 * Google Таблицы, оттенок гуляет. Смотрим на смысл — синего заметно больше,
 * чем красного и зелёного.
 */
function blueFonts(stylesXml: string): { blue: Set<number>; yellowFill: Set<number> } {
  const blue = new Set<number>();
  const fontsBlock = /<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(stylesXml)?.[1] ?? "";
  let i = 0;
  for (const m of fontsBlock.matchAll(/<font>([\s\S]*?)<\/font>/g)) {
    const rgb = /<color\b[^>]*rgb="([0-9A-Fa-f]{6,8})"/.exec(m[1] ?? "")?.[1];
    if (rgb) {
      const hex = rgb.slice(-6);
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (b > 120 && b - r > 50 && b - g > 40) blue.add(i);
    }
    i++;
  }

  const yellowFill = new Set<number>();
  const fillsBlock = /<fills\b[^>]*>([\s\S]*?)<\/fills>/.exec(stylesXml)?.[1] ?? "";
  let j = 0;
  for (const m of fillsBlock.matchAll(/<fill>([\s\S]*?)<\/fill>/g)) {
    const rgb = /<fgColor\b[^>]*rgb="([0-9A-Fa-f]{6,8})"/.exec(m[1] ?? "")?.[1];
    if (rgb) {
      const hex = rgb.slice(-6);
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (r > 200 && g > 180 && b < 160) yellowFill.add(j);
    }
    j++;
  }
  return { blue, yellowFill };
}

/** Стиль ячейки → (шрифт, заливка). */
function styleIndex(stylesXml: string): Array<{ font: number; fill: number }> {
  const block = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  return [...block.matchAll(/<xf\b[^>]*>/g)].map((m) => ({
    font: Number(attr(m[0], "fontId") || 0),
    fill: Number(attr(m[0], "fillId") || 0),
  }));
}

type RowCells = Map<number, Map<string, string>>;

/** Разбираем лист в «строка → ячейки»: дальше по нему и ищем, и правим. */
function rowsOf(xml: string): RowCells {
  const rows: RowCells = new Map();
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = Number(attr(`<row ${rm[1]}>`, "r") || 0);
    const cells = new Map<string, string>();
    for (const cm of (rm[2] ?? "").matchAll(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)) {
      cells.set(attr(cm[0], "r"), cm[0]);
    }
    rows.set(r, cells);
  }
  return rows;
}

/**
 * Карта полей шаблона: что вообще разрешено заполнять.
 *
 * Подпись берём слева по строке, заголовок — из шапки таблицы сверху:
 * без них «C13» ничего не значит ни человеку, ни агенту.
 */
export async function templateFields(buf: Buffer): Promise<SheetField[]> {
  const book = await openBook(buf);
  const stylesXml = book.zip.get("xl/styles.xml")?.read().toString("utf8") ?? "";
  const { blue, yellowFill } = blueFonts(stylesXml);
  const styles = styleIndex(stylesXml);

  const out: SheetField[] = [];
  for (const sheet of book.sheets) {
    const rows = rowsOf(sheet.xml);
    // Шапка таблицы: первая строка, где больше двух подписей подряд справа.
    let headerRow = 0;
    for (const [r, cells] of [...rows].sort((a, b) => a[0] - b[0])) {
      const filled = [...cells].filter(
        ([ref, c]) => colNum(COL(ref)) >= 3 && cellText(c, book.shared),
      );
      if (filled.length >= 3) {
        headerRow = r;
        break;
      }
    }

    for (const [r, cells] of [...rows].sort((a, b) => a[0] - b[0])) {
      for (const [ref, cell] of [...cells].sort((a, b) => colNum(COL(a[0])) - colNum(COL(b[0])))) {
        if (hasFormula(cell)) continue;
        const style = styles[Number(attr(cell, "s") || 0)];
        if (!style || !blue.has(style.font)) continue;

        // Подпись строки — ближайший текст слева.
        let label = "";
        for (const c of ["A", "B", "C"]) {
          const near = cells.get(`${c}${r}`);
          if (near && near !== cell && !hasFormula(near)) {
            const t = cellText(near, book.shared);
            if (t) {
              label = t;
              break;
            }
          }
        }
        // Подсказка — текст правее, если он не формула и не число.
        let hint = "";
        for (const c of ["D", "E", "H"]) {
          const near = cells.get(`${c}${r}`);
          if (near && near !== cell && !hasFormula(near)) {
            const t = cellText(near, book.shared);
            if (t && Number.isNaN(Number(t))) {
              hint = t;
              break;
            }
          }
        }
        // Заголовок колонки живёт в строке шапки, а не в строке поля: без
        // этого четыре квартала подряд подписаны одинаково и неразличимы.
        const head = headerRow ? rows.get(headerRow)?.get(`${COL(ref)}${headerRow}`) : undefined;
        const column = head ? cellText(head, book.shared) : "";

        out.push({
          sheet: sheet.name,
          ref,
          label,
          column: column === label ? "" : column,
          example: cellText(cell, book.shared),
          hint,
          key: yellowFill.has(style.fill),
        });
      }
    }
  }
  return out;
}

/**
 * Карта полей словами — её агент видит вместе с шаблоном.
 *
 * Без неё модель гадает адреса ячеек по текстовой выжимке таблицы и ошибается
 * на строку-другую; с ней — называет ровно то, что есть.
 */
export function fieldsBrief(name: string, fields: SheetField[]): string {
  const lines: string[] = [
    `Карта полей шаблона «${name}». Заполнять можно ТОЛЬКО эти ячейки — остальное считается формулами и правке не подлежит.`,
  ];
  let sheet = "";
  for (const f of fields) {
    if (f.sheet !== sheet) {
      sheet = f.sheet;
      lines.push(`\nЛист «${sheet}»`);
    }
    const parts = [`  ${f.ref} — ${f.label || "(без подписи)"}`];
    if (f.column) parts.push(`колонка «${f.column}»`);
    if (f.example) parts.push(`в шаблоне пример: ${f.example}`);
    if (f.hint) parts.push(`подсказка: ${f.hint}`);
    if (f.key) parts.push("КЛЮЧЕВОЕ ДОПУЩЕНИЕ — спросят первым");
    lines.push(parts.join(" · "));
  }
  return lines.join("\n");
}

/**
 * Ячейки из ответа агента.
 *
 * Агент возвращает поля таблицей: лист, ячейка, значение и откуда взято.
 * Разбираем только строки, где вторая колонка похожа на адрес — заголовки,
 * пояснения и разделители таблицы отсеиваются сами.
 */
export function cellsFromMarkdown(text: string): FilledCell[] {
  const out: FilledCell[] = [];
  const seen = new Set<string>();

  for (const line of text.split("\n")) {
    if (!line.includes("|")) continue;
    const cols = line
      .split("|")
      .map((c) => c.trim())
      .filter((c, i, arr) => !(c === "" && (i === 0 || i === arr.length - 1)));
    if (cols.length < 3) continue;

    const sheet = cols[0]?.replace(/^«|»$/g, "").trim() ?? "";
    const ref = (cols[1] ?? "").replace(/\$/g, "").trim().toUpperCase();
    const value = cols[2]?.trim() ?? "";
    if (!sheet || !/^[A-Z]{1,3}\d{1,5}$/.test(ref)) continue;
    // «[данных нет]» — это честный ответ, но в ячейку он не пишется: пустое
    // поле в модели виднее, чем строка-заглушка вместо числа.
    if (!value || /^\[?данных нет\]?$/i.test(value) || value === "—" || value === "-") continue;

    const key = `${sheet}!${ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ sheet, ref, value });
  }
  return out;
}

/**
 * Ответ Счетовода — в вид, пригодный для Word.
 *
 * Таблица «Лист / Ячейка / Значение» — разметка для машины: по ней платформа
 * заполняет шаблон. Человеку в записке она бесполезна и занимает страницы:
 * «Вводные C14 = 6290» не говорит ничего. Поэтому в Word уходит записка, а
 * подставленные значения — приложением, но подписями полей из шаблона:
 * «Текущее значение метрики (база), млн ₽ — 6290 — выгрузка BI».
 *
 * Сама модель в Word не переносится вовсе: она многолистовая и со формулами,
 * её место — файл Excel рядом.
 */
export function answerForNote(text: string, fields: SheetField[]): string {
  const cells = cellsFromMarkdown(text);
  if (!cells.length) return text;

  // Режем по заголовкам первого уровня: раздел с таблицей полей — служебный.
  const parts: { head: string; body: string[] }[] = [{ head: "", body: [] }];
  for (const line of text.split("\n")) {
    if (/^#\s+\S/.test(line)) parts.push({ head: line, body: [] });
    else parts[parts.length - 1]!.body.push(line);
  }

  const kept = parts.filter((p) => {
    const whole = [p.head, ...p.body].join("\n");
    // В разделе есть строки-адреса — значит это таблица для заполнения.
    return !cellsFromMarkdown(whole).length;
  });

  const note = kept
    .map((p) => [p.head, ...p.body].join("\n"))
    .join("\n")
    .trim();

  const label = (c: FilledCell): string => {
    const f = fields.find(
      (x) => x.sheet.toLowerCase() === c.sheet.toLowerCase() && x.ref === c.ref.toUpperCase(),
    );
    if (!f) return `${c.sheet} · ${c.ref}`;
    const head = f.column ? ` (${f.column})` : "";
    return `${f.label || c.ref}${head} · лист «${c.sheet}»`;
  };

  // Источник у каждой строки свой — вытаскиваем из той же таблицы ответа.
  const sources = new Map<string, string>();
  for (const line of text.split("\n")) {
    const cols = line.split("|").map((x) => x.trim());
    const ref = cols[2]?.replace(/\$/g, "").toUpperCase() ?? "";
    if (/^[A-Z]{1,3}\d{1,5}$/.test(ref) && cols[4]) sources.set(`${cols[1]}!${ref}`, cols[4]);
  }

  const rows = cells
    .map((c) => `| ${label(c)} | ${c.value} | ${sources.get(`${c.sheet}!${c.ref}`) ?? ""} |`)
    .join("\n");

  return `${note}\n\n# Что подставлено в модель\n\nЗаполненная модель — отдельным файлом Excel; здесь видно, что и откуда в неё встало.\n\n| Поле | Значение | Источник |\n|---|---|---|\n${rows}\n`;
}

// ── Запись книги ──────────────────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Число ли это по-человечески: «1 200,5», «28800», «0,82». */
function asNumber(raw: string): number | null {
  const t = raw
    .trim()
    .replace(/\s|\u00a0/g, "")
    .replace(",", ".")
    .replace(/%$/, "");
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  // Проценты в шаблоне хранятся долями: 15% — это 0,15.
  return raw.trim().endsWith("%") ? n / 100 : n;
}

/** Новая ячейка вместо старой: число числом, текст — строкой внутри ячейки. */
function cellXml(ref: string, style: string, value: string): string {
  const s = style ? ` s="${style}"` : "";
  const num = asNumber(value);
  if (num !== null) return `<c r="${ref}"${s}><v>${num}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

/**
 * Подставить значения в шаблон.
 *
 * Пишем только в разрешённые поля. Всё, что модель попыталась записать мимо —
 * в ячейку с формулой или в несуществующее место, — возвращаем списком:
 * человек должен знать, что часть ответа не легла в файл.
 */
export async function fillTemplate(
  buf: Buffer,
  values: FilledCell[],
): Promise<{ file: Buffer; filled: number; skipped: string[] }> {
  const book = await openBook(buf);
  const fields = await templateFields(buf);
  const allowed = new Set(fields.map((f) => `${f.sheet}!${f.ref}`));

  const skipped: string[] = [];
  let filled = 0;
  const changed = new Map<string, string>();

  for (const sheet of book.sheets) {
    const mine = values.filter(
      (v) => v.sheet.trim().toLowerCase() === sheet.name.trim().toLowerCase(),
    );
    if (!mine.length) continue;

    let xml = sheet.xml;
    const rows = rowsOf(xml);

    for (const item of mine) {
      const ref = item.ref.replace(/\$/g, "").toUpperCase();
      if (!allowed.has(`${sheet.name}!${ref}`)) {
        skipped.push(`${sheet.name}!${ref} — не поле для ввода (формула или чужая ячейка)`);
        continue;
      }
      const r = ROW(ref);
      const old = rows.get(r)?.get(ref);
      if (!old) {
        skipped.push(`${sheet.name}!${ref} — такой ячейки в шаблоне нет`);
        continue;
      }
      xml = xml.replace(old, cellXml(ref, attr(old, "s"), item.value));
      // Правим и разбор, иначе две правки в одной строке перетрут друг друга.
      rows.get(r)?.set(ref, cellXml(ref, attr(old, "s"), item.value));
      filled++;
    }

    if (xml !== sheet.xml) changed.set(sheet.path, xml);
  }

  // Кэш формул в файле остался от шаблона — просим пересчитать при открытии,
  // иначе человек увидит цифры примера рядом со своими вводными.
  const wbPath = "xl/workbook.xml";
  let wbXml = book.zip.get(wbPath)?.read().toString("utf8") ?? "";
  if (wbXml) {
    wbXml = /<calcPr\b[^>]*\/>/.test(wbXml)
      ? wbXml.replace(/<calcPr\b[^>]*\/>/, '<calcPr calcId="0" fullCalcOnLoad="1"/>')
      : wbXml.replace("</workbook>", '<calcPr calcId="0" fullCalcOnLoad="1"/></workbook>');
    changed.set(wbPath, wbXml);
  }

  const file = await writeZip(book.zip, changed);
  return { file, filled, skipped };
}

/**
 * Собрать zip заново: изменённые записи пишем без сжатия, остальные —
 * байт в байт из исходного файла.
 */
async function writeZip(zip: Map<string, ZipEntry>, changed: Map<string, string>): Promise<Buffer> {
  const { deflateRawSync, crc32 } = (await import("node:zlib")) as typeof import("node:zlib") & {
    crc32?: (data: Buffer) => number;
  };

  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  const crcOf = (data: Buffer): number => (crc32 ? crc32(data) : crcFallback(data));

  for (const [name, entry] of zip) {
    const raw = changed.has(name) ? Buffer.from(changed.get(name) ?? "", "utf8") : entry.read();
    const comp = deflateRawSync(raw, { level: 6 });
    const crc = crcOf(raw);
    const nameBuf = Buffer.from(name, "utf8");

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // версия
    local.writeUInt16LE(0x0800, 6); // имена в utf-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, comp);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(comp.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + comp.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(zip.size, 8);
  end.writeUInt16LE(zip.size, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...parts, centralBuf, end]);
}

/** На старых node crc32 в zlib нет — считаем сами, таблица строится один раз. */
let crcTable: Uint32Array | null = null;
function crcFallback(data: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of data) crc = (crcTable[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
