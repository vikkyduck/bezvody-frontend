/**
 * Документы, которые приносит человек.
 *
 * Два места, откуда они берутся, и оба нужны:
 *   — клиент прикладывает материалы к своему окну (отчёт, выгрузка, договор);
 *   — администратор кладёт агенту постоянные документы (методика, стандарт,
 *     шаблон), и их видит каждый клиент этого агента.
 *
 * Файл живёт на сервере в РФ рядом с перепиской. Наружу к модели уходит либо
 * распознанный текст, либо сам файл — если модель умеет читать его как есть.
 */

/** Как файл поедет к модели. */
export type DocKind =
  /** PDF — отдаём модели целиком: она видит вёрстку, таблицы и подписи */
  | "pdf"
  /** Картинка — отдаём как изображение */
  | "image"
  /** Офисный документ — распознаём текст при загрузке */
  | "office"
  /** Обычный текст — берём как есть */
  | "text";

export type StoredFile = {
  id: string;
  /** Имя, как его назвал человек: показываем и отдаём при скачивании */
  name: string;
  /** Откуда приехал, если его не приносили руками: адрес ссылки */
  source?: string;
  mime: string;
  size: number;
  kind: DocKind;
  at: string;
  /** Сколько текста распознали. Ноль у PDF и картинок — их читает сама модель */
  chars: number;
  /** Что пошло не так при распознавании — честно показываем в интерфейсе */
  note: string;
};

// ── Пределы ───────────────────────────────────────────────────────────────────
// Ограничения не выдуманы: 32 МБ — потолок запроса к модели, а окно контекста
// не резиновое. Лучше сказать об этом при загрузке, чем оборвать ответ на полуслове.

export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_WINDOW_FILES = 15;
export const MAX_AGENT_FILES = 10;
/** Сколько всего весят документы одного окна — чтобы диск не рос без спроса */
export const MAX_WINDOW_BYTES = 400 * 1024 * 1024;
export const MAX_AGENT_BYTES = 200 * 1024 * 1024;
/**
 * Картинку модель принимает маленькой — это её предел, не наш каприз.
 * Тяжёлое фото проще пересохранить, чем спорить с API.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/**
 * До этого размера PDF уезжает к модели файлом — она читает вёрстку и таблицы
 * своими глазами. Выше начинается предел запроса (32 МБ на всё), поэтому
 * большой PDF мы распознаём в текст у себя.
 */
export const MAX_PDF_NATIVE_BYTES = 25 * 1024 * 1024;
/** Сколько распознанного текста уедет к модели за один вопрос */
export const MAX_TEXT_CHARS = 300_000;
/** Сколько «сырых» байт (PDF, картинки) влезает в один запрос */
export const MAX_RAW_BYTES = 24 * 1024 * 1024;

// ── Что принимаем ─────────────────────────────────────────────────────────────

const byExt: Record<string, DocKind> = {
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  docx: "office",
  xlsx: "office",
  pptx: "office",
  txt: "text",
  md: "text",
  csv: "text",
  tsv: "text",
  json: "text",
  xml: "text",
  log: "text",
};

const imageMime: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export const extOf = (name: string) => (name.split(".").pop() ?? "").toLowerCase();

export const kindOf = (name: string): DocKind | null => byExt[extOf(name)] ?? null;

/** Тип для модели: она проверяет media_type строго, на глазок сюда нельзя. */
export function mimeOf(name: string, fallback: string): string {
  const ext = extOf(name);
  if (ext === "pdf") return "application/pdf";
  if (imageMime[ext]) return imageMime[ext]!;
  return fallback || "application/octet-stream";
}

export const SUPPORTED_HINT = "PDF, Word, Excel, PowerPoint, текст, CSV, картинки";

/** Почему файл не приняли — словами, которые можно показать человеку. */
export function rejectReason(name: string, size: number): string {
  if (!kindOf(name)) {
    const ext = extOf(name);
    if (ext === "doc" || ext === "xls" || ext === "ppt") {
      return `${name}: старый формат Office. Пересохраните как .${ext}x — и загрузится`;
    }
    return `${name}: такой формат не читается. Принимаем ${SUPPORTED_HINT}`;
  }
  if (size > MAX_FILE_BYTES)
    return `${name}: ${humanSize(size)} — больше ${humanSize(MAX_FILE_BYTES)}`;
  if (kindOf(name) === "image" && size > MAX_IMAGE_BYTES) {
    return `${name}: картинка тяжелее ${humanSize(MAX_IMAGE_BYTES)} — модель такую не примет, пересохраните поменьше`;
  }
  if (size === 0) return `${name}: файл пустой`;
  return "";
}

/** Готовое вложение для запроса к модели. */
export type Attachment = {
  title: string;
  kind: DocKind;
  /** Распознанный текст — для офисных и текстовых файлов */
  text: string;
  /** Сам файл — для PDF и картинок, их модель читает своими глазами */
  base64: string;
  mime: string;
  /** Чей документ: постоянный у агента или принесённый человеком */
  origin: "agent" | "person";
};

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
}

/** Одна строка про файл под его именем: размер и что с ним стало. */
export function fileNote(f: StoredFile): string {
  const bits: string[] = [];
  if (f.size) bits.push(humanSize(f.size));

  if (f.note) bits.push(f.note);
  else if (f.kind === "pdf") {
    // Большой PDF модель файлом не принимает — мы распознали его сами.
    bits.push(
      f.chars
        ? `PDF, распознано ${f.chars.toLocaleString("ru-RU")} знаков`
        : "PDF, агент читает целиком",
    );
  } else if (f.kind === "image") bits.push("изображение");
  else if (!f.chars) bits.push("текста не нашлось");
  else bits.push(`${f.chars.toLocaleString("ru-RU")} знаков текста`);

  if (f.source) bits.push("по ссылке");
  return bits.join(" · ");
}
