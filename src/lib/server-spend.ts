/**
 * Отчёт о расходах. Только сервер.
 *
 * Отвечает на три вопроса, которые задаёт владелец: сколько всего, на кого и
 * на что. Всё в рублях: токены — единица работы модели, а не денег, и по ним
 * нельзя ни выставить счёт, ни решить, какой агент себя не окупает.
 *
 * Считаем по журналу вызовов, где цена уже записана на момент вызова. Ничего
 * не пересчитываем задним числом: месяц, закрытый в марте, в апреле должен
 * выглядеть так же.
 */
import { createServerFn } from "@tanstack/react-start";

export type SpendRow = {
  key: string;
  name: string;
  rub: number;
  calls: number;
  input: number;
  cacheRead: number;
  output: number;
  /** Сколько минут модель на это работала — видно, где долгие прогоны */
  minutes: number;
};

export type SpendReport = {
  month: string;
  /** Какие месяцы есть в журнале — для переключателя */
  months: string[];
  total: number;
  /** Тот же итог в долларах: курс меняется, а провайдеру платится валютой */
  totalUsd: number;
  calls: number;
  byPerson: SpendRow[];
  byAgent: SpendRow[];
  byPass: SpendRow[];
  byModel: SpendRow[];
  /** Модели, для которых цены не нашлось: их расход посчитан нулём */
  unpriced: { model: string; calls: number }[];
  usdRub: number;
};

const empty = (month: string): SpendReport => ({
  month,
  months: [],
  total: 0,
  totalUsd: 0,
  calls: 0,
  byPerson: [],
  byAgent: [],
  byPass: [],
  byModel: [],
  unpriced: [],
  usdRub: 0,
});

const thisMonth = () => new Date().toISOString().slice(0, 7);

export const spendReportServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; month?: string }) => data)
  .handler(async ({ data }): Promise<SpendReport> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    const month = data.month?.trim() || thisMonth();
    if (!me || me.role !== "admin") return empty(month);

    const usage = await import("./server-usage");
    const { readPriceBook } = await import("./server-prices");
    const { agentById } = await import("./shtab-data");
    const { passesOf } = await import("./passes");

    const [events, months, book] = await Promise.all([
      usage.readMonth(month),
      usage.knownMonths(),
      readPriceBook(),
    ]);

    // Имена прогонов берём из настроек агентов: в журнале лежит только id.
    const cfgAll = await d.readJson<Record<string, { passes?: { id: string; name: string }[] }>>(
      `${d.dataDir()}/agents.json`,
      {},
    );
    const passName = (agentId: string, passId: string): string => {
      if (!passId) return "Разговор";
      const list = passesOf(agentId, cfgAll[agentId]?.passes as never);
      return list.find((p) => p.id === passId)?.name ?? passId;
    };

    const add = (
      map: Map<string, SpendRow>,
      key: string,
      name: string,
      e: import("./server-usage").UsageEvent,
    ) => {
      const row = map.get(key) ?? {
        key,
        name,
        rub: 0,
        calls: 0,
        input: 0,
        cacheRead: 0,
        output: 0,
        minutes: 0,
      };
      row.rub += e.rub;
      row.calls += 1;
      row.input += e.input;
      row.cacheRead += e.cacheRead;
      row.output += e.output;
      row.minutes += e.seconds / 60;
      map.set(key, row);
    };

    const people = new Map<string, SpendRow>();
    const agents = new Map<string, SpendRow>();
    const passes = new Map<string, SpendRow>();
    const models = new Map<string, SpendRow>();
    const unpriced = new Map<string, number>();

    let total = 0;
    let totalUsd = 0;
    for (const e of events) {
      total += e.rub;
      totalUsd += e.usd ?? 0;
      add(people, e.personId, e.personName, e);
      add(agents, e.agentId, agentById(e.agentId)?.name ?? e.agentId, e);
      add(passes, `${e.agentId}:${e.passId}`, passName(e.agentId, e.passId), e);
      add(models, e.model, e.model, e);
      if (e.unpriced) unpriced.set(e.model, (unpriced.get(e.model) ?? 0) + 1);
    }

    const sorted = (m: Map<string, SpendRow>) =>
      [...m.values()].sort((a, b) => b.rub - a.rub || b.calls - a.calls);

    return {
      month,
      months: months.length ? months : [month],
      total,
      totalUsd,
      calls: events.length,
      byPerson: sorted(people),
      byAgent: sorted(agents),
      byPass: sorted(passes),
      byModel: sorted(models),
      unpriced: [...unpriced.entries()].map(([model, calls]) => ({ model, calls })),
      usdRub: book.usdRub,
    };
  });
