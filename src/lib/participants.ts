/**
 * Участник платформы — общий тип для сервера и браузера.
 *
 * Участник = личный кабинет: имя, контакт для связи, код доступа и свой
 * набор агентов. Агенты назначаются человеку, а не компании: два человека
 * из одной команды могут иметь разные наборы, и это нормально.
 *
 * Код передаётся из рук в руки — ни почта, ни телеграм отсюда ничего
 * не отправляют. Контакты нужны, чтобы знать, куда написать.
 */

export type Role = "client" | "project" | "admin";

export const roleLabel: Record<Role, string> = {
  client: "Заказчик",
  project: "Проджект-менеджер",
  admin: "Администратор",
};

export type Participant = {
  id: string;
  name: string;
  /** Должность или роль в компании — свободный текст, можно пусто */
  position: string;
  /** Компания или подразделение — свободный текст, можно пусто */
  company: string;
  email: string;
  /** Ник в телеграме, приводится к одному виду при вводе */
  telegram: string;
  role: Role;
  code: string;
  /** Какие агенты открыты именно этому человеку */
  agentIds: string[];
  createdAt: string;
  lastUsedAt: string | null;
  /** Отозванный код остаётся в списке: видно, кому и что открывали */
  active: boolean;
  /**
   * Руководитель: видит, над какими задачами работают его люди и прогнали ли
   * они документ через систему. Не отдельная роль, а свойство обычного
   * кабинета — у руководителя есть и своя работа, отбирать её незачем.
   */
  leads?: boolean;
  /**
   * Служебный кабинет: не показывается руководителю. Нужен для тестовых
   * и внутренних кабинетов, которым в списке команды делать нечего.
   */
  hidden?: boolean;
  /**
   * Куда присылать готовый разбор, кроме кабинета. Пусто — никуда: молчание
   * по умолчанию честнее, чем рассылка, о которой человек не просил.
   */
  deliver?: { telegram: boolean; email: boolean };
  /** Привязан ли телеграм — считает сервер, в справочнике этого нет */
  tgLinked?: boolean;
  /**
   * Видна ли работа этого человека какому-нибудь руководителю. Считается
   * сервером и отдаётся вместе с кабинетом: об этом надо честно сказать
   * в интерфейсе, а не оставлять человека в неведении.
   */
  watched?: boolean;
};

export type ParticipantDraft = {
  name: string;
  position?: string;
  company?: string;
  email?: string;
  telegram?: string;
  role: Role;
};

/**
 * Первый и единственный кабинет из коробки — ваш. Всех остальных заводите
 * руками в админке: самостоятельной регистрации на платформе нет.
 */
export const seedParticipants: Participant[] = [
  {
    id: "p-utkina",
    name: "Виктория Уткина",
    position: "Основатель",
    company: "Без Воды",
    email: "hello@vi-utkina.ru",
    telegram: "",
    role: "admin",
    code: "BV-ADMIN-01",
    agentIds: [],
    createdAt: "—",
    lastUsedAt: null,
    active: true,
  },
];

/** Ник приводим к одному виду: без собаки и без ссылки — её добавит интерфейс. */
export function cleanTelegram(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^@/, "")
    .trim();
}

/** Старая запись могла быть без новых полей — добиваем значениями по умолчанию. */
export function normalize(p: Partial<Participant>): Participant {
  return {
    id: p.id ?? `p-${Math.random().toString(36).slice(2, 9)}`,
    name: p.name ?? "Без имени",
    position: p.position ?? "",
    company: p.company ?? "",
    email: p.email ?? "",
    telegram: p.telegram ?? "",
    role: p.role ?? "client",
    code: p.code ?? "",
    agentIds: p.agentIds ?? [],
    createdAt: p.createdAt ?? "—",
    lastUsedAt: p.lastUsedAt ?? null,
    active: p.active ?? true,
    leads: p.leads ?? false,
    hidden: p.hidden ?? false,
    deliver: p.deliver ?? { telegram: false, email: false },
  };
}

const translitMap: Record<string, string> = {
  а: "A",
  б: "B",
  в: "V",
  г: "G",
  д: "D",
  е: "E",
  ё: "E",
  ж: "ZH",
  з: "Z",
  и: "I",
  й: "Y",
  к: "K",
  л: "L",
  м: "M",
  н: "N",
  о: "O",
  п: "P",
  р: "R",
  с: "S",
  т: "T",
  у: "U",
  ф: "F",
  х: "H",
  ц: "C",
  ч: "CH",
  ш: "SH",
  щ: "SCH",
  ъ: "",
  ы: "Y",
  ь: "",
  э: "E",
  ю: "YU",
  я: "YA",
};

const translit = (s: string) =>
  s
    .toLowerCase()
    .split("")
    .map((ch) => translitMap[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]/gi, "");

const rolePrefix: Record<Role, string> = { admin: "BV", project: "BV-PM", client: "BV" };

/**
 * Имя, которое на самом деле код доступа.
 *
 * На входе поле кода помечено username, чтобы браузер его запомнил и человек
 * не лез за кодом в переписку. Тот же браузер подставлял запомненное в первое
 * текстовое поле админки — и в справочнике заводились кабинеты с именем
 * «BV-ADMIN-01», а из имени выходил код «BV-BVADMIN01». Автозаполнение в форме
 * мы выключили, но полагаться на это нельзя: проверка стоит и на сервере.
 */
export const looksLikeAccessCode = (name: string): boolean => /^bv-/i.test(name.trim());

/** Код читается вслух и не повторяется: префикс, фамилия, при совпадении — номер. */
export function uniqueCode(name: string, role: Role, existing: Participant[]): string {
  const surname = translit(name.trim().split(/\s+/).pop() ?? "").toUpperCase() || "USER";
  const base = `${rolePrefix[role]}-${surname}`;
  const taken = new Set(existing.map((x) => x.code));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36).toUpperCase()}`;
}

/** Чужие коды наружу не отдаём: чужой код — это чужой вход. */
export const withoutCode = (p: Participant): Participant => ({ ...p, code: "" });
