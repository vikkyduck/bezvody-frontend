/**
 * Журнал расхода на модели. Только сервер.
 *
 * Токены — не деньги. «Вход 9 321, выход 3 780» в журнале сервиса ничего не
 * говорит ни о том, во что обошёлся клиент, ни о том, какой агент съедает
 * бюджет. Поэтому каждый вызов модели записывается строкой: кто спрашивал,
 * какой агент отвечал, каким прогоном, какой моделью, сколько токенов и
 * сколько это стоило в рублях по цене на момент вызова.
 *
 * Цену считаем и записываем СРАЗУ, а не при показе отчёта: цены у провайдеров
 * меняются, курс тоже, и пересчитывать прошлое по сегодняшнему курсу — значит
 * каждый месяц видеть новые цифры за один и тот же март.
 *
 * Файл на месяц, по строке на вызов (JSONL): дописывание в конец переживает
 * одновременные записи, а месяц — естественная единица счёта за работу.
 */
import type { Provider } from "./providers";

export type UsageEvent = {
  at: string;
  personId: string;
  personName: string;
  agentId: string;
  /** Прогон конвейера; у обычного разговора пусто */
  passId: string;
  /** Роль, от лица которой шёл разговор; пусто у обычного агента */
  roleId: string;
  provider: Provider;
  model: string;
  /** Токены входа, не считая прочитанных из кеша */
  input: number;
  /** Прочитано из кеша — считается по своей, низкой цене */
  cacheRead: number;
  /** Записано в кеш — дороже обычного входа */
  cacheWrite: number;
  output: number;
  seconds: number;
  /** Стоимость в рублях по цене и курсу на момент вызова */
  rub: number;
  /** Она же в долларах: курс меняется, а доллар — то, что берёт провайдер */
  usd: number;
  /** По какому курсу считали — чтобы старые цифры можно было объяснить */
  rate: number;
  /** Цены на эту модель не нашлось: расход посчитан нулём, и это видно */
  unpriced: boolean;
};

/** Кто и в каком качестве спрашивает модель. Пробрасывается до самого вызова. */
export type Who = {
  personId: string;
  personName: string;
  agentId: string;
  passId?: string;
  roleId?: string;
};

const monthOf = (iso: string) => iso.slice(0, 7);

const fileFor = async (month: string) =>
  `${(await import("./server-data")).dataDir()}/usage/${month}.jsonl`;

/**
 * Записать вызов. Ошибку глотаем: журнал расхода не должен уронить ответ,
 * который человек уже ждёт. Потерянная строка — неприятность, потерянный
 * ответ — потерянная работа.
 */
export async function recordUsage(event: UsageEvent): Promise<void> {
  try {
    const { appendFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    const file = await fileFor(monthOf(event.at));
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(event)}\n`, "utf8");
  } catch (err) {
    console.error(
      "[расход] не удалось записать строку: " +
        (err instanceof Error ? err.message.slice(0, 160) : "неизвестная ошибка"),
    );
  }
}

/** Все строки месяца. Битую строку пропускаем — журнал важнее одной записи. */
export async function readMonth(month: string): Promise<UsageEvent[]> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(await fileFor(month), "utf8");
    const out: UsageEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as UsageEvent);
      } catch {
        /* битая строка — пропускаем */
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Какие месяцы вообще есть — для переключателя в отчёте. */
export async function knownMonths(): Promise<string[]> {
  try {
    const { readdir } = await import("node:fs/promises");
    const d = await import("./server-data");
    const files = await readdir(`${d.dataDir()}/usage`);
    return files
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.replace(".jsonl", ""))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}
