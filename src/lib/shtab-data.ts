/**
 * Каталог агентов и решения.
 *
 * Наполнения здесь больше нет: платформа пустая и ждёт настоящих агентов.
 * Остались типы и таксономия блоков — то, во что это наполнение ляжет,
 * когда появится API. Каждый экран умеет показывать пустоту словами,
 * а не пустым местом, поэтому «пока ничего нет» — рабочее состояние,
 * а не поломка.
 */

export type AgentStatus = "active" | "available";

/**
 * Десять предметных блоков каталога плюс горизонтальные агенты,
 * которые нужны любому блоку (слайды, «6-pager», протокол, источники).
 */
export type DomainKey =
  | "rezultaty"
  | "dengi"
  | "klienty"
  | "produkt"
  | "operacii"
  | "rynok"
  | "iniciativy"
  | "riski"
  | "organizaciya"
  | "strategiya"
  | "gorizont";

export const domains: { key: DomainKey; num: string; name: string; note: string }[] = [
  { key: "rezultaty", num: "01", name: "Результаты и причины", note: "Что изменилось в показателях и почему именно" },
  { key: "dengi", num: "02", name: "Деньги и финансы", note: "Кэш, дебиторка, себестоимость, прогноз бюджета" },
  { key: "klienty", num: "03", name: "Клиенты и продажи", note: "Воронка, отток, концентрация, экономика клиента" },
  { key: "produkt", num: "04", name: "Продукт и цена", note: "Ассортимент, цена, скидки, маржинальность позиций" },
  { key: "operacii", num: "05", name: "Операции и поставки", note: "Узкие места, сроки, запасы, подрядчики" },
  { key: "rynok", num: "06", name: "Рынок и конкуренты", note: "Что делают игроки, куда идёт спрос, где окно" },
  { key: "iniciativy", num: "07", name: "Инициативы и проекты", note: "Что финансировать, что остановить, где конфликт ресурсов" },
  { key: "riski", num: "08", name: "Риски и соответствие", note: "Что может сорваться и что требует регламента" },
  { key: "organizaciya", num: "09", name: "Организация работы", note: "Нагрузка, сроки, регламенты и потери на стыках" },
  { key: "strategiya", num: "10", name: "Стратегия и развитие", note: "Куда идём, чем отличаемся, где растём" },
  { key: "gorizont", num: "—", name: "Для всех блоков", note: "Горизонтальные агенты: оформить, упаковать, проверить источники" },
];

export type Agent = {
  id: string;
  domain: DomainKey;
  /** Имя агента — что именно он делает */
  name: string;
  /** Метод внутри — мелким шрифтом, не главное */
  method: string;
  /** Результат для человека: что он получит на руки */
  result: string;
  cadence: string;
  status: AgentStatus;
  steps: string[];
};

/** Агентов пока нет ни одного — их заводит администратор. */
export const agents: Agent[] = [];

// ── Решения ───────────────────────────────────────────────────────────────────

export type Source = {
  /** Система-источник: 1С, CRM, BI, реестр */
  system: string;
  /** Какой срез выгружен */
  slice: string;
  /** Объём выборки */
  volume: string;
  /** Дата и время последней сверки */
  checked: string;
};

export type Finding = { claim: string; evidence: string; delta: string; source: Source };

export type Option = {
  name: string;
  effect: string;
  risk: string;
  /** Сценарный ярлык: пессимистичный / реалистичный / оптимистичный */
  scenario?: "Пессимистичный" | "Реалистичный" | "Оптимистичный";
};

export type Brief = {
  id: string;
  agentId: string;
  title: string;
  date: string;
  confidence: number;
  dataQuality: string;
  status: "Требует решения" | "На контроле" | "Решение принято";
  /** Срок, до которого решение имеет смысл */
  due: string;
  /** Цена вопроса — что стоит на кону */
  stake: string;
  /** Предлагаемый владелец решения */
  owner: string;
  /** Индекс варианта, который агент рекомендует */
  recommend: number;
  /** Когда проверяем эффект после подписи */
  review: string;
  /** Свежесть данных — одной строкой у заголовка */
  freshness: string;
  summary: string;
  findings: Finding[];
  options: Option[];
  question: string;
};

/** Решения появляются из работы агентов — пока их нет. */
export const briefs: Brief[] = [];

/**
 * Уверенность словами, а не процентом: цифра без объяснения — шум.
 */
export function confidenceLabel(b: Brief): string {
  const level = b.confidence >= 80 ? "высокая" : b.confidence >= 65 ? "средняя" : "низкая";
  const n = b.findings.length;
  const word = n === 1 ? "источник" : n < 5 ? "источника" : "источников";
  return `уверенность ${level} · ${n} ${word}`;
}
