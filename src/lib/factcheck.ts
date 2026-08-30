/**
 * Машинная сверка документа до и после конвейера.
 *
 * Верификатор-модель читает двадцать тысяч знаков и может не заметить, что
 * «14%» стало «14 п.п.». Поэтому числа, источники и пометки сличает код: он
 * не устаёт и не «примерно помнит». Модель получает готовый список расхождений
 * и решает только спорное — что вернуть, а что законно исчезло при сокращении.
 *
 * Сравниваем мешки значений, а не строки: при усушке текст переставляется,
 * абзацы съезжают, и построчное сравнение дало бы сплошной шум. Нас волнует
 * другое — было число в документе или пропало, и не появилось ли новое,
 * которого не было в сборке.
 */

/** Сравниваем только тело: разбор законно меняется по ходу конвейера. */
export function documentPart(text: string): string {
  const at = text.search(/^#{1,3}\s*Разбор и вопросы\s*$/im);
  return at >= 0 ? text.slice(0, at) : text;
}

const NBSP = /[\u00A0\u202F\u2009\u2007]/g;

/**
 * Числа вместе с единицей: «14%», «120 млн», «3 п.п.» — разные величины, и
 * потеря единицы искажает смысл сильнее, чем потеря самого числа.
 */
function numbers(text: string): string[] {
  const clean = text
    .replace(NBSP, " ")
    // Ссылки на источники разбираем отдельно: иначе «И-1» читается как число
    .replace(/\[И-\d+\]/g, " ");
  const out: string[] = [];
  const re =
    /(-?\d+(?:[ \u00A0]\d{3})*(?:[.,]\d+)?)\s*(%|п\.?\s?п\.?|млн|млрд|тыс\.?|₽|руб\.?|шт\.?|мес\.?|дн\.?|ч\.?|раз)?/gi;
  for (const m of clean.matchAll(re)) {
    const value = (m[1] ?? "").replace(/ /g, "").replace(",", ".");
    // Одиночные мелкие числа — это нумерация списков и заголовков, а не факты.
    if (!m[2] && Number(value) <= 12 && !value.includes(".")) continue;
    const unit = (m[2] ?? "").toLowerCase().replace(/\s|\./g, "");
    out.push(unit ? `${value} ${unit}` : value);
  }
  return out;
}

const sources = (text: string): string[] => text.match(/\[И-\d+\]/g) ?? [];

const marks = (text: string): string[] => [
  ...(text.match(/\[данных нет\]/gi) ?? []).map(() => "[данных нет]"),
  ...(text.match(/предположение/gi) ?? []).map(() => "предположение"),
];

const headings = (text: string): string[] =>
  (text.match(/^#{1,3}[ \t]+.+$/gm) ?? []).map((h) => h.replace(/^#+\s*/, "").trim());

/** Сколько раз каждое значение встретилось. */
function counted(list: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const v of list) map.set(v, (map.get(v) ?? 0) + 1);
  return map;
}

/** Чего стало меньше: вернёт значения с числом пропаж. */
function lost(before: string[], after: string[]): { value: string; times: number }[] {
  const a = counted(after);
  const out: { value: string; times: number }[] = [];
  for (const [value, times] of counted(before)) {
    const left = a.get(value) ?? 0;
    if (left < times) out.push({ value, times: times - left });
  }
  return out;
}

export type FactReport = {
  /** Готовые строки для верификатора — на языке человека */
  lines: string[];
  /** Сколько расхождений нашлось всего: по нему решаем, звать ли модель */
  total: number;
};

const LIMIT = 60;

/**
 * Что изменилось между сборкой и итогом.
 *
 * Отдельно называем появившееся: число, которого в сборке не было, — это либо
 * пересчёт (законно, но должно быть объяснено), либо выдумка. И то и другое
 * стоит показать человеку.
 */
export function compareFacts(before: string, after: string): FactReport {
  const b = documentPart(before);
  const a = documentPart(after);

  const lines: string[] = [];
  let total = 0;

  const add = (title: string, items: { value: string; times: number }[], suffix = "") => {
    if (!items.length) return;
    total += items.length;
    const shown = items.slice(0, LIMIT);
    lines.push(
      `${title}: ${shown
        .map((i) => (i.times > 1 ? `${i.value} (×${i.times})` : i.value))
        .join(", ")}${items.length > LIMIT ? ` и ещё ${items.length - LIMIT}` : ""}${suffix}`,
    );
  };

  add("Числа, пропавшие после сборки", lost(numbers(b), numbers(a)));
  add("Числа, которых в сборке не было", lost(numbers(a), numbers(b)));
  add("Пропавшие ссылки на источники", lost(sources(b), sources(a)));
  add("Пропавшие пометки", lost(marks(b), marks(a)));

  const lostHeadings = lost(headings(b), headings(a));
  add("Пропавшие заголовки разделов", lostHeadings);

  const sizeBefore = b.trim().length;
  const sizeAfter = a.trim().length;
  lines.push(
    `Объём тела: было ${sizeBefore.toLocaleString("ru-RU")} знаков, стало ${sizeAfter.toLocaleString("ru-RU")}`,
  );

  return { lines, total };
}

/** Список расхождений текстом — таким он уезжает верификатору. */
export function factReportText(report: FactReport): string {
  if (!report.total) {
    return `МАШИННАЯ СВЕРКА\nРасхождений по числам, источникам и пометкам не найдено.\n${report.lines.join("\n")}`;
  }
  return `МАШИННАЯ СВЕРКА\nПлатформа сличила сборку и итог. Найдено расхождений: ${report.total}. Разберись с каждым — что вернуть, а что законно исчезло при сокращении.\n\n${report.lines.join("\n")}`;
}
