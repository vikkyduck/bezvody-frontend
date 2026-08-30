import { useCallback, useEffect, useState } from "react";

import { rub, type Price } from "@/lib/prices";
import { getPricesServer, savePricesServer, type PricesView } from "@/lib/server-prices";
import { spendReportServer, type SpendReport, type SpendRow } from "@/lib/server-spend";
import { useSession } from "@/lib/session";

/**
 * Расходы в деньгах: сколько всего, на кого и на что.
 *
 * Токены здесь не главное. Владельцу нужно знать, во что обошёлся клиент,
 * какой агент съедает бюджет и какой прогон конвейера дороже остальных, —
 * ответы на это в рублях, а токены рядом мелким шрифтом, чтобы было видно,
 * из чего цифра сложилась.
 *
 * Отдельная строка — модели, цены на которые платформа не знает. Их расход
 * посчитан нулём, и молчать об этом нельзя: ноль читается как «бесплатно».
 */

const monthName = (m: string) => {
  const [y, mm] = m.split("-");
  const names = [
    "январь",
    "февраль",
    "март",
    "апрель",
    "май",
    "июнь",
    "июль",
    "август",
    "сентябрь",
    "октябрь",
    "ноябрь",
    "декабрь",
  ];
  return `${names[Number(mm) - 1] ?? m} ${y}`;
};

const tokens = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1).replace(".", ",")} млн`
    : n >= 1000
      ? `${Math.round(n / 1000)} тыс.`
      : String(n);

export function Spend() {
  const { code } = useSession();
  const [report, setReport] = useState<SpendReport | null>(null);
  const [month, setMonth] = useState("");
  const [prices, setPrices] = useState<PricesView | null>(null);
  const [showPrices, setShowPrices] = useState(false);
  const [rate, setRate] = useState("");

  const load = useCallback(
    (m?: string) => {
      if (!code) return;
      spendReportServer({ data: { code, ...(m ? { month: m } : {}) } })
        .then((r) => {
          setReport(r);
          setMonth(r.month);
        })
        .catch(() => setReport(null));
    },
    [code],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!code) return;
    getPricesServer({ data: { code } })
      .then((p) => {
        setPrices(p);
        setRate(String(p.book.usdRub));
      })
      .catch(() => setPrices(null));
  }, [code]);

  async function saveRate() {
    if (!code || !Number(rate)) return;
    const next = await savePricesServer({ data: { code, usdRub: Number(rate) } });
    setPrices(next);
    load(month);
  }

  async function savePrice(model: string, price: Price | null) {
    if (!code) return;
    setPrices(await savePricesServer({ data: { code, model, price } }));
  }

  if (!report) return <p className="text-[13px] text-muted-foreground">Загружаю…</p>;

  return (
    <div className="space-y-10">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold">Расходы на модели</h2>
            <p className="measure mt-1 text-[12.5px] text-muted-foreground">
              Считается по каждому вызову, в рублях, по цене на момент вызова. Задним числом ничего
              не пересчитывается: закрытый месяц выглядит одинаково всегда.
            </p>
          </div>
          {report.months.length > 1 ? (
            <select
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                load(e.target.value);
              }}
              className="rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3 py-2 text-[13px] outline-none"
            >
              {report.months.map((m) => (
                <option key={m} value={m}>
                  {monthName(m)}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <div className="mt-6 grid gap-6 border-y border-[color:var(--color-line)] py-6 sm:grid-cols-3">
          <div>
            <div className="t-number text-[34px] leading-none tabular-nums">
              {rub(report.total)}
            </div>
            <div className="mt-1.5 text-[12.5px] text-muted-foreground">
              всего за {monthName(report.month)}
              {report.totalUsd ? ` · $${report.totalUsd.toFixed(2)}` : ""}
            </div>
          </div>
          <div>
            <div className="t-number text-[34px] leading-none tabular-nums">{report.calls}</div>
            <div className="mt-1.5 text-[12.5px] text-muted-foreground">обращений к моделям</div>
          </div>
          <div>
            <div className="t-number text-[34px] leading-none tabular-nums">
              {report.calls ? rub(report.total / report.calls) : "0 ₽"}
            </div>
            <div className="mt-1.5 text-[12.5px] text-muted-foreground">в среднем за обращение</div>
          </div>
        </div>

        {report.unpriced.length ? (
          <p className="measure mt-4 text-[12.5px] text-[color:var(--color-error)]">
            Цены нет для {report.unpriced.map((u) => `${u.model} (${u.calls})`).join(", ")} — расход
            по ним посчитан нулём. Впишите цену ниже, иначе итог занижен.
          </p>
        ) : null}
      </section>

      <Table title="По участникам" note="Кому сколько стоило обслужить." rows={report.byPerson} />
      <Table title="По агентам" note="Какой агент съедает бюджет." rows={report.byAgent} />
      <Table
        title="По прогонам"
        note="Разговор и каждый шаг сборки отдельно — видно, что дороже."
        rows={report.byPass}
      />
      <Table title="По моделям" note="Во что обходится каждая модель." rows={report.byModel} />

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[15px] font-semibold">Цены и курс</h2>
          <button onClick={() => setShowPrices((v) => !v)} className="btn btn-glass text-[12px]">
            {showPrices ? "Свернуть" : "Показать"}
          </button>
        </div>
        <p className="measure mt-1 text-[12.5px] text-muted-foreground">
          Цены за миллион токенов в долларах, как их публикуют провайдеры. Курс — ваш, по нему
          считаются рубли. И то и другое меняется чаще, чем платформа, поэтому правится здесь. Новый
          курс действует на будущие обращения: уже посчитанное задним числом не меняется, поэтому
          курс стоит выставить сразу.
        </p>

        {showPrices && prices ? (
          <div className="mt-4 space-y-5">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="label-caps">Курс доллара</span>
                <input
                  value={rate}
                  onChange={(e) => setRate(e.target.value.replace(",", "."))}
                  inputMode="decimal"
                  className="mt-1.5 w-[140px] rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3 py-2 text-[13px] outline-none"
                />
              </label>
              <button onClick={() => void saveRate()} className="btn btn-primary text-[12.5px]">
                Сохранить курс
              </button>
              {prices.book.updatedAt ? (
                <span className="text-[11.5px] text-muted-foreground">
                  правили {new Date(prices.book.updatedAt).toLocaleDateString("ru-RU")}
                </span>
              ) : null}
            </div>

            <PriceTable view={prices} onSave={savePrice} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Table({ title, note, rows }: { title: string; note: string; rows: SpendRow[] }) {
  return (
    <section>
      <h2 className="mb-1 text-[15px] font-semibold">{title}</h2>
      <p className="measure mb-4 text-[12.5px] text-muted-foreground">{note}</p>
      {rows.length ? (
        <ul className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-baseline justify-between gap-3 py-3">
              <span className="min-w-0">
                <span className="block text-[14px]">{r.name}</span>
                <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                  {r.calls} обращ. · вход {tokens(r.input)}
                  {r.cacheRead ? ` (+${tokens(r.cacheRead)} из кеша)` : ""} · выход{" "}
                  {tokens(r.output)} · {Math.round(r.minutes)} мин
                </span>
              </span>
              <span className="t-number flex-none text-[15px] tabular-nums">{rub(r.rub)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted-foreground">За этот месяц обращений не было.</p>
      )}
    </section>
  );
}

/** Правка цены одной модели: свои цифры поверх тех, что зашиты в код. */
function PriceTable({
  view,
  onSave,
}: {
  view: PricesView;
  onSave: (model: string, price: Price | null) => Promise<void>;
}) {
  const models = [
    ...new Set([...Object.keys(view.defaults), ...Object.keys(view.book.prices)]),
  ].sort();
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  function start(model: string) {
    const p = view.book.prices[model] ?? view.defaults[model];
    setEdit(model);
    setDraft({
      input: String(p?.input ?? 0),
      output: String(p?.output ?? 0),
      cacheRead: String(p?.cacheRead ?? 0),
      cacheWrite: String(p?.cacheWrite ?? 0),
    });
  }

  return (
    <ul className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
      {models.map((m) => {
        const own = view.book.prices[m];
        const p = own ?? view.defaults[m];
        return (
          <li key={m} className="py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="text-[13.5px]">
                {m}
                {own ? (
                  <span className="ml-2 text-[11px] text-[color:var(--color-accent)]">
                    своя цена
                  </span>
                ) : null}
              </span>
              <span className="flex items-baseline gap-3">
                <span className="text-[12px] text-muted-foreground">
                  вход ${p?.input ?? "—"} · выход ${p?.output ?? "—"} · кеш ${p?.cacheRead ?? "—"}
                </span>
                <button
                  onClick={() => (edit === m ? setEdit(null) : start(m))}
                  className="btn btn-ghost text-[11.5px]"
                >
                  {edit === m ? "Отмена" : "Править"}
                </button>
                {own ? (
                  <button
                    onClick={() => void onSave(m, null)}
                    className="btn btn-ghost text-[11.5px] text-muted-foreground"
                  >
                    Вернуть
                  </button>
                ) : null}
              </span>
            </div>

            {edit === m ? (
              <div className="mt-3 flex flex-wrap items-end gap-2.5">
                {(["input", "output", "cacheRead", "cacheWrite"] as const).map((field) => (
                  <label key={field} className="block">
                    <span className="label-caps">
                      {field === "input"
                        ? "вход"
                        : field === "output"
                          ? "выход"
                          : field === "cacheRead"
                            ? "чтение кеша"
                            : "запись в кеш"}
                    </span>
                    <input
                      value={draft[field] ?? ""}
                      onChange={(e) =>
                        setDraft({ ...draft, [field]: e.target.value.replace(",", ".") })
                      }
                      inputMode="decimal"
                      className="mt-1.5 w-[110px] rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3 py-2 text-[13px] outline-none"
                    />
                  </label>
                ))}
                <button
                  onClick={() => {
                    void onSave(m, {
                      input: Number(draft["input"]) || 0,
                      output: Number(draft["output"]) || 0,
                      cacheRead: Number(draft["cacheRead"]) || 0,
                      cacheWrite: Number(draft["cacheWrite"]) || 0,
                    });
                    setEdit(null);
                  }}
                  className="btn btn-primary text-[12px]"
                >
                  Сохранить
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
