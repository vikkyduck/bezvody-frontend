/**
 * Таблица цен и курс — то, что правит администратор. Только сервер.
 *
 * Цены у провайдеров меняются чаще, чем мы выкатываем платформу, а курс —
 * чаще, чем цены. И то и другое должно правиться в админке за минуту, без
 * программиста. В коде остаются значения по умолчанию: они верны на день
 * написания и служат запасным вариантом.
 */
import { createServerFn } from "@tanstack/react-start";

import { DEFAULT_PRICES, emptyPriceBook, type Price, type PriceBook } from "./prices";

const file = async () => `${(await import("./server-data")).dataDir()}/prices.json`;

export async function readPriceBook(): Promise<PriceBook> {
  const d = await import("./server-data");
  const raw = await d.readJson<Partial<PriceBook>>(await file(), {});
  return {
    prices: raw.prices ?? {},
    usdRub: Number(raw.usdRub) > 0 ? Number(raw.usdRub) : emptyPriceBook().usdRub,
    updatedAt: raw.updatedAt ?? null,
  };
}

export type PricesView = {
  book: PriceBook;
  /** Цены из кода — чтобы админка показала, от чего отклонились */
  defaults: Record<string, Price>;
};

export const getPricesServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }): Promise<PricesView> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me || me.role !== "admin") return { book: emptyPriceBook(), defaults: {} };
    return { book: await readPriceBook(), defaults: DEFAULT_PRICES };
  });

export const savePricesServer = createServerFn({ method: "POST" })
  .validator(
    (data: { code: string; usdRub?: number; model?: string; price?: Price | null }) => data,
  )
  .handler(async ({ data }): Promise<PricesView> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me || me.role !== "admin") return { book: emptyPriceBook(), defaults: {} };

    const book = await readPriceBook();
    if (Number(data.usdRub) > 0) book.usdRub = Number(data.usdRub);

    const model = data.model?.trim();
    if (model) {
      // null означает «вернуть цену из кода», а не «сделать бесплатной».
      if (data.price === null) delete book.prices[model];
      else if (data.price) {
        book.prices[model] = {
          input: Math.max(0, Number(data.price.input) || 0),
          output: Math.max(0, Number(data.price.output) || 0),
          cacheRead: Math.max(0, Number(data.price.cacheRead) || 0),
          cacheWrite: Math.max(0, Number(data.price.cacheWrite) || 0),
        };
      }
    }

    book.updatedAt = new Date().toISOString();
    await d.writeJson(await file(), book);
    return { book, defaults: DEFAULT_PRICES };
  });
