/**
 * Цены на модели и пересчёт токенов в деньги.
 *
 * Цены живут отдельно от кода вызова по двум причинам. Во-первых, они меняются
 * чаще, чем мы правим платформу, и админ должен уметь поправить цифру сам, не
 * дожидаясь выкатки. Во-вторых, считать надо в рублях: расход в токенах не
 * отвечает ни на один вопрос, который задаёт себе владелец бизнеса.
 *
 * Значения ниже — цены за миллион токенов в долларах, как их публикуют
 * провайдеры. Курс задаётся отдельно и тоже правится в админке: привязывать
 * бизнес-учёт к курсу, зашитому в код, — способ однажды удивиться.
 *
 * Модели, которой нет в таблице, стоят «неизвестно»: расход по ней считается
 * нулём, и это ВИДНО в отчёте отдельной строкой. Тихий ноль хуже пропуска:
 * он выглядит как «бесплатно».
 */

/** Цена за миллион токенов, в долларах. */
export type Price = {
  input: number;
  output: number;
  /** Чтение из кеша — обычно десятая часть входа */
  cacheRead?: number;
  /** Запись в кеш — обычно дороже входа */
  cacheWrite?: number;
};

/**
 * Ключ — имя модели. Совпадение ищем сначала точное, потом по началу строки:
 * у провайдеров рядом с «gpt-5» живёт «gpt-5-2025-08-07» с той же ценой.
 */
export const DEFAULT_PRICES: Record<string, Price> = {
  // Anthropic — platform.claude.com/docs/en/about-claude/pricing, сверено 30.08.2026.
  // Запись в кеш у нас пятиминутная (ephemeral): 1,25× входа.
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },

  // OpenAI — developers.openai.com/api/docs/pricing, 30.08.2026.
  // Отдельной платы за запись в кеш у них нет.
  "gpt-5": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  "gpt-5-mini": { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
  "gpt-5-nano": { input: 0.05, output: 0.4, cacheRead: 0.005, cacheWrite: 0 },

  // Google — ai.google.dev/gemini-api/docs/pricing, 30.08.2026.
  // ВНИМАНИЕ: у 3.7 и 3.6 Flash цена вводная и действует до 31.12.2026,
  // с 1 января она ровно вдвое выше — 1,5 / 7,5 / 0,15. Поправьте здесь же
  // в админке, когда это случится.
  "gemini-3.7-flash": { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
  "gemini-3.5-flash": { input: 1.5, output: 9, cacheRead: 0.15, cacheWrite: 0 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
  "gemini-3.1-pro": { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
  "gemini-2.5-pro": { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
};

/** Курс по умолчанию. Правится в админке — там же, где цены. */
export const DEFAULT_USD_RUB = 100;

export type PriceBook = {
  /** Переопределения цен: имя модели → цена в долларах за миллион */
  prices: Record<string, Price>;
  usdRub: number;
  updatedAt: string | null;
};

export const emptyPriceBook = (): PriceBook => ({
  prices: {},
  usdRub: DEFAULT_USD_RUB,
  updatedAt: null,
});

/** Цена модели: сначала правка админа, потом таблица, потом совпадение по началу. */
export function priceOf(model: string, book?: PriceBook | null): Price | null {
  const name = model.trim();
  if (!name) return null;

  const own = book?.prices ?? {};
  if (own[name]) return own[name]!;
  if (DEFAULT_PRICES[name]) return DEFAULT_PRICES[name]!;

  // «gpt-5-2025-08-07» стоит столько же, сколько «gpt-5»: берём самое длинное
  // совпадение по началу, иначе «gpt-5» перебил бы «gpt-5-mini».
  const keys = [...Object.keys(own), ...Object.keys(DEFAULT_PRICES)]
    .filter((k) => name.startsWith(k))
    .sort((a, b) => b.length - a.length);
  const best = keys[0];
  return best ? (own[best] ?? DEFAULT_PRICES[best] ?? null) : null;
}

export type Tokens = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
};

/**
 * Во что обошёлся вызов, в рублях.
 *
 * Кеш считаем отдельно: у Claude чтение из кеша в десять раз дешевле входа, и
 * без этого отчёт завышал бы расход в разы — инструкция агента на десять тысяч
 * токенов читается из кеша при каждом вопросе.
 */
export function costOf(
  model: string,
  t: Tokens,
  book?: PriceBook | null,
): { usd: number; rub: number; rate: number } | null {
  const p = priceOf(model, book);
  if (!p) return null;
  const rate = book?.usdRub || DEFAULT_USD_RUB;
  const usd =
    (t.input * p.input +
      t.cacheRead * (p.cacheRead ?? p.input) +
      t.cacheWrite * (p.cacheWrite ?? p.input) +
      t.output * p.output) /
    1_000_000;
  return { usd, rub: usd * rate, rate };
}

/** Деньги на экран: рубли без копеек, но мелкие суммы — с копейками. */
export function rub(value: number): string {
  if (!value) return "0 ₽";
  if (value < 10) return `${value.toFixed(2).replace(".", ",")} ₽`;
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`;
}
