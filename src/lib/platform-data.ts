/**
 * Модель платформы: кто есть кто, кому что открыто, сколько израсходовано.
 *
 * Три роли, и они отвечают на три разных вопроса:
 *   client  — «что мне решать сегодня» (работает в окнах с агентами);
 *   project — «как идут мои клиенты» (назначает агентов, следит за расходом);
 *   admin   — «как идёт бизнес» (выдаёт доступы, видит деньги по всем).
 *
 * Данные здесь учебные и живут в браузере: платформа их ещё не отдаёт.
 * Когда появится API, уходит только этот файл — типы ниже и есть контракт.
 */

export type Role = "client" | "project" | "admin";

export const roleLabel: Record<Role, string> = {
  client: "Клиент",
  project: "Проджект",
  admin: "Администратор",
};

/**
 * Кредит — единица расхода на работу агентов, 1 000 токенов модели.
 * Клиент считает в кредитах, чтобы не думать про токены; администратор
 * видит и токены, и рубли себестоимости.
 */
export const CREDIT_TOKENS = 1000;
export const CREDIT_COST_RUB = 2.4;

export type Client = {
  id: string;
  /** Компания — она покупает доступ и платит по счёту */
  company: string;
  /** Подразделение, которое работает в кабинете */
  unit: string;
  /** Кто из команды «Без Воды» ведёт клиента */
  managerId: string;
  openedAt: string;
  /** Доступ открыт до этой даты — оплата по счёту, не по карте */
  paidUntil: string;
  invoiceRub: number;
  creditsGranted: number;
  creditsUsed: number;
  lastActiveAt: string;
  /** Агентов подключает проджект или администратор, сам клиент — не может */
  agentIds: string[];
  state: "Работает" | "Пилот" | "Пауза";
};

export type Person = {
  id: string;
  name: string;
  position: string;
  role: Role;
  /** У клиента — его компания; у проджекта и администратора — null */
  clientId: string | null;
};

/**
 * Код доступа = логин. Пароля нет: код выдаёт администратор, он же его
 * отзывает. Здесь код лежит открыто, потому что это макет; на сервере
 * храним отпечаток для поиска и обратимый шифр для показа — так сделано
 * в ФинДоходе, и открытым текстом коды больше не лежат нигде.
 */
export type AccessCode = {
  code: string;
  personId: string;
  issuedAt: string;
  lastUsedAt: string | null;
  active: boolean;
};

export const people: Person[] = [
  { id: "p-utkina", name: "Виктория Уткина", position: "Основатель", role: "admin", clientId: null },
  { id: "p-ratochka", name: "Дарья Раточка", position: "Проджект", role: "project", clientId: null },
  { id: "p-syrtsov", name: "Артём Сырцов", position: "Проджект", role: "project", clientId: null },

  { id: "p-kovaleva", name: "Анна Ковалёва", position: "Коммерческий директор", role: "client", clientId: "c-sem" },
  { id: "p-demin", name: "Игорь Дёмин", position: "Финансовый директор", role: "client", clientId: "c-sem" },
  { id: "p-luts", name: "Мария Луц", position: "Операционный директор", role: "client", clientId: "c-orbita" },
  { id: "p-kim", name: "Павел Ким", position: "Директор по развитию", role: "client", clientId: "c-vektor" },
  { id: "p-nikolaeva", name: "Ольга Николаева", position: "Генеральный директор", role: "client", clientId: "c-prime" },
];

export const clients: Client[] = [
  {
    id: "c-sem",
    company: "ГК «Северэнергомаш»",
    unit: "Коммерческий блок",
    managerId: "p-ratochka",
    openedAt: "12.03.2026",
    paidUntil: "31.12.2026",
    invoiceRub: 630000,
    creditsGranted: 200000,
    creditsUsed: 128400,
    lastActiveAt: "2026-08-16",
    agentIds: ["kpi-root-cause", "weekly-pulse", "cash-forecast", "customer-economics", "price-review"],
    state: "Работает",
  },
  {
    id: "c-orbita",
    company: "«Орбита-Логистик»",
    unit: "Операции",
    managerId: "p-ratochka",
    openedAt: "04.05.2026",
    paidUntil: "04.11.2026",
    invoiceRub: 440000,
    creditsGranted: 120000,
    creditsUsed: 31900,
    lastActiveAt: "2026-07-29",
    agentIds: ["bottleneck", "lead-time", "inventory", "suppliers"],
    state: "Работает",
  },
  {
    id: "c-vektor",
    company: "«Вектор Девелопмент»",
    unit: "Стратегия и развитие",
    managerId: "p-syrtsov",
    openedAt: "18.06.2026",
    paidUntil: "18.09.2026",
    invoiceRub: 150000,
    creditsGranted: 40000,
    creditsUsed: 4200,
    lastActiveAt: "2026-06-30",
    agentIds: ["market-map", "competitor-profile"],
    state: "Пилот",
  },
  {
    id: "c-prime",
    company: "«Прайм Ритейл»",
    unit: "Аппарат генерального",
    managerId: "p-syrtsov",
    openedAt: "22.01.2026",
    paidUntil: "22.01.2027",
    invoiceRub: 820000,
    creditsGranted: 260000,
    creditsUsed: 214700,
    lastActiveAt: "2026-08-15",
    agentIds: ["kpi-root-cause", "plan-fact", "cash-forecast", "receivables", "churn", "assortment"],
    state: "Работает",
  },
];

export const accessCodes: AccessCode[] = [
  { code: "BV-ADMIN-01", personId: "p-utkina", issuedAt: "12.01.2026", lastUsedAt: "16.08.2026", active: true },
  { code: "BV-PM-RATOCHKA", personId: "p-ratochka", issuedAt: "12.01.2026", lastUsedAt: "16.08.2026", active: true },
  { code: "BV-PM-SYRTSOV", personId: "p-syrtsov", issuedAt: "03.04.2026", lastUsedAt: "14.08.2026", active: true },
  { code: "SEM-KOVALEVA", personId: "p-kovaleva", issuedAt: "12.03.2026", lastUsedAt: "16.08.2026", active: true },
  { code: "SEM-DEMIN", personId: "p-demin", issuedAt: "12.03.2026", lastUsedAt: "11.08.2026", active: true },
  { code: "ORB-LUTS", personId: "p-luts", issuedAt: "04.05.2026", lastUsedAt: "29.07.2026", active: true },
  { code: "VEK-KIM", personId: "p-kim", issuedAt: "18.06.2026", lastUsedAt: "30.06.2026", active: true },
  { code: "PRM-NIKOLAEVA", personId: "p-nikolaeva", issuedAt: "22.01.2026", lastUsedAt: "15.08.2026", active: true },
];

/** Расход по агентам за текущий месяц — основа аудита кредитов. */
export type UsageRow = { clientId: string; agentId: string; runs: number; credits: number };

export const usage: UsageRow[] = [
  { clientId: "c-sem", agentId: "kpi-root-cause", runs: 14, credits: 21600 },
  { clientId: "c-sem", agentId: "weekly-pulse", runs: 9, credits: 6300 },
  { clientId: "c-sem", agentId: "cash-forecast", runs: 6, credits: 15800 },
  { clientId: "c-sem", agentId: "customer-economics", runs: 4, credits: 9400 },
  { clientId: "c-sem", agentId: "price-review", runs: 0, credits: 0 },

  { clientId: "c-orbita", agentId: "bottleneck", runs: 5, credits: 8100 },
  { clientId: "c-orbita", agentId: "lead-time", runs: 3, credits: 3900 },
  { clientId: "c-orbita", agentId: "inventory", runs: 2, credits: 2600 },
  { clientId: "c-orbita", agentId: "suppliers", runs: 0, credits: 0 },

  { clientId: "c-vektor", agentId: "market-map", runs: 2, credits: 3100 },
  { clientId: "c-vektor", agentId: "competitor-profile", runs: 1, credits: 1100 },

  { clientId: "c-prime", agentId: "kpi-root-cause", runs: 18, credits: 27400 },
  { clientId: "c-prime", agentId: "plan-fact", runs: 11, credits: 14900 },
  { clientId: "c-prime", agentId: "cash-forecast", runs: 8, credits: 20100 },
  { clientId: "c-prime", agentId: "receivables", runs: 7, credits: 8800 },
  { clientId: "c-prime", agentId: "churn", runs: 3, credits: 5200 },
  { clientId: "c-prime", agentId: "assortment", runs: 0, credits: 0 },
];

// ── Производные величины ──────────────────────────────────────────────────────

export const byId = <T extends { id: string }>(list: T[], id: string | null) =>
  list.find((x) => x.id === id);

export const clientOf = (clientId: string | null) => byId(clients, clientId);
export const personOf = (personId: string | null) => byId(people, personId);

export const creditsLeft = (c: Client) => c.creditsGranted - c.creditsUsed;
export const creditsPct = (c: Client) => Math.round((c.creditsUsed / c.creditsGranted) * 100);

/** Себестоимость израсходованного — то, что мы реально заплатили моделям. */
export const costRub = (credits: number) => Math.round(credits * CREDIT_COST_RUB);

/** Сколько осталось от счёта после расходов на модели. */
export const marginRub = (c: Client) => c.invoiceRub - costRub(c.creditsUsed);

export const usageOf = (clientId: string) => usage.filter((u) => u.clientId === clientId);

export const clientsOf = (managerId: string) => clients.filter((c) => c.managerId === managerId);

/** Сколько дней клиент не заходил. Молчание — первый признак оттока. */
export function silentDays(c: Client, today = "2026-08-16"): number {
  const ms = Date.parse(today) - Date.parse(c.lastActiveAt);
  return Math.max(0, Math.round(ms / 86400000));
}

export const nf = (n: number) => n.toLocaleString("ru-RU");
export const rub = (n: number) => nf(n) + " ₽";
