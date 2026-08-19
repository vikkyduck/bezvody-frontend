/**
 * Кто есть кто на платформе и кому что открыто.
 *
 * Три роли, и они отвечают на три разных вопроса:
 *   client  — «что мне решать сегодня» (работает в окнах с агентами);
 *   project — «как идут мои клиенты» (назначает агентов, следит за работой);
 *   admin   — «как идёт платформа» (выдаёт доступы, ведёт каталог).
 *
 * Учёта расхода здесь пока нет намеренно: считать нечего, пока агенты
 * не работают по-настоящему. Вернём вместе с настоящим счётчиком.
 *
 * Ниже — минимальный скелет входа: по одному человеку на роль. Настоящих
 * людей и компании заводят в кабинете администратора, а не здесь.
 */

export type Role = "client" | "project" | "admin";

export const roleLabel: Record<Role, string> = {
  client: "Клиент",
  project: "Проджект",
  admin: "Администратор",
};

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
  lastActiveAt: string;
  /** Агентов открывает проджект или администратор, сам клиент — не может */
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
  { id: "p-manager", name: "Проджект-менеджер", position: "Ведёт клиентов", role: "project", clientId: null },
  { id: "p-client", name: "Первый клиент", position: "Руководитель", role: "client", clientId: "c-first" },
];

export const clients: Client[] = [
  {
    id: "c-first",
    company: "Компания не заведена",
    unit: "Команда не настроена",
    managerId: "p-manager",
    openedAt: "—",
    paidUntil: "—",
    lastActiveAt: "2026-08-17",
    agentIds: [],
    state: "Пилот",
  },
];

export const accessCodes: AccessCode[] = [
  { code: "BV-ADMIN-01", personId: "p-utkina", issuedAt: "—", lastUsedAt: null, active: true },
  { code: "BV-PM-01", personId: "p-manager", issuedAt: "—", lastUsedAt: null, active: true },
  { code: "BV-CLIENT-01", personId: "p-client", issuedAt: "—", lastUsedAt: null, active: true },
];

// ── Производные величины ──────────────────────────────────────────────────────

export const byId = <T extends { id: string }>(list: T[], id: string | null) =>
  list.find((x) => x.id === id);

export const clientOf = (clientId: string | null) => byId(clients, clientId);
export const personOf = (personId: string | null) => byId(people, personId);

export const clientsOf = (managerId: string) => clients.filter((c) => c.managerId === managerId);

/** Сколько дней клиент не заходил. Молчание — первый признак оттока. */
export function silentDays(c: Client, today = "2026-08-17"): number {
  const ms = Date.parse(today) - Date.parse(c.lastActiveAt);
  if (Number.isNaN(ms)) return 0;
  return Math.max(0, Math.round(ms / 86400000));
}

export const nf = (n: number) => n.toLocaleString("ru-RU");
