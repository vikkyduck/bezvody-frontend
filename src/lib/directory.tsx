/**
 * Справочник участников — то, что администратор заводит руками.
 *
 * Участник = личный кабинет: имя, контакт для связи, код доступа и свой
 * набор агентов. Агенты назначаются человеку, а не компании: два человека
 * из одной команды могут иметь разные наборы, и это нормально.
 *
 * Код передаётся из рук в руки — ни почта, ни телеграм отсюда ничего не
 * отправляют. Контакты нужны, чтобы знать, куда написать, и не более.
 *
 * Пока нет бэкенда, справочник живёт в localStorage браузера: заведённое
 * переживает перезагрузку, но остаётся на этой машине. Когда появится API,
 * меняется только тело этого файла — экраны его не заметят.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { Role } from "./platform-data";

export type Participant = {
  id: string;
  name: string;
  /** Должность или роль в компании — свободный текст, можно пусто */
  position: string;
  /** Компания или подразделение — свободный текст, можно пусто */
  company: string;
  email: string;
  /** Ник в телеграме, с собакой или без — приводим к одному виду при вводе */
  telegram: string;
  role: Role;
  code: string;
  /** Какие агенты открыты именно этому человеку */
  agentIds: string[];
  createdAt: string;
  lastUsedAt: string | null;
  /** Отозванный код остаётся в списке: видно, кому и что открывали */
  active: boolean;
};

const KEY = "bv-directory";

/** Скелет входа: по одному человеку на роль, иначе в кабинеты не попасть. */
const seed: Participant[] = [
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
  {
    id: "p-manager",
    name: "Проджект-менеджер",
    position: "Ведёт клиентов",
    company: "Без Воды",
    email: "",
    telegram: "",
    role: "project",
    code: "BV-PM-01",
    agentIds: [],
    createdAt: "—",
    lastUsedAt: null,
    active: true,
  },
  {
    id: "p-client",
    name: "Первый клиент",
    position: "Руководитель",
    company: "",
    email: "",
    telegram: "",
    role: "client",
    code: "BV-CLIENT-01",
    agentIds: [],
    createdAt: "—",
    lastUsedAt: null,
    active: true,
  },
];

export type ParticipantDraft = {
  name: string;
  position?: string;
  company?: string;
  email?: string;
  telegram?: string;
  role: Role;
  agentIds?: string[];
};

type Directory = {
  participants: Participant[];
  /** false, пока не прочитали localStorage: до этого никого не пускаем */
  ready: boolean;
  add: (draft: ParticipantDraft) => Participant;
  update: (id: string, patch: Partial<Omit<Participant, "id" | "code">>) => void;
  remove: (id: string) => void;
  /** Открыть или закрыть агента конкретному человеку */
  toggleAgent: (id: string, agentId: string) => void;
  setActive: (id: string, active: boolean) => void;
  markUsed: (id: string) => void;
  byCode: (code: string) => Participant | undefined;
  byId: (id: string | null) => Participant | undefined;
};

const Ctx = createContext<Directory | null>(null);

export function DirectoryProvider({ children }: { children: ReactNode }) {
  const [participants, setParticipants] = useState<Participant[]>(seed);
  const [ready, setReady] = useState(false);

  // Читаем уже на клиенте: на сервере localStorage нет, и рендер разъехался бы.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Participant[];
        if (Array.isArray(saved) && saved.length) setParticipants(saved.map(normalize));
      }
    } catch {
      /* повреждённая запись не должна мешать войти — работаем со скелетом */
    }
    setReady(true);
  }, []);

  // Пишем только после чтения: иначе первый рендер затёр бы сохранённое скелетом.
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(participants));
    } catch {
      /* приватный режим или переполненное хранилище — работаем без записи */
    }
  }, [participants, ready]);

  // Зависит от participants намеренно: код проверяется на уникальность по
  // текущему списку и возвращается наружу — его сразу показывают администратору.
  const add = useCallback((draft: ParticipantDraft) => {
    const base: Participant = {
      id: `p-${Math.random().toString(36).slice(2, 9)}`,
      name: draft.name.trim(),
      position: (draft.position ?? "").trim(),
      company: (draft.company ?? "").trim(),
      email: (draft.email ?? "").trim(),
      telegram: cleanTelegram(draft.telegram ?? ""),
      role: draft.role,
      code: "",
      agentIds: draft.agentIds ?? [],
      createdAt: new Date().toLocaleDateString("ru-RU"),
      lastUsedAt: null,
      active: true,
    };
    const created = { ...base, code: uniqueCode(base, participants) };
    setParticipants((prev) => [created, ...prev]);
    return created;
  }, [participants]);

  const update = useCallback((id: string, patch: Partial<Omit<Participant, "id" | "code">>) => {
    setParticipants((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, ...patch, ...(patch.telegram !== undefined ? { telegram: cleanTelegram(patch.telegram) } : {}) }
          : p,
      ),
    );
  }, []);

  const remove = useCallback((id: string) => {
    setParticipants((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const toggleAgent = useCallback((id: string, agentId: string) => {
    setParticipants((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              agentIds: p.agentIds.includes(agentId)
                ? p.agentIds.filter((x) => x !== agentId)
                : [...p.agentIds, agentId],
            }
          : p,
      ),
    );
  }, []);

  const setActive = useCallback((id: string, active: boolean) => {
    setParticipants((prev) => prev.map((p) => (p.id === id ? { ...p, active } : p)));
  }, []);

  const markUsed = useCallback((id: string) => {
    const today = new Date().toLocaleDateString("ru-RU");
    setParticipants((prev) => prev.map((p) => (p.id === id ? { ...p, lastUsedAt: today } : p)));
  }, []);

  const value = useMemo<Directory>(
    () => ({
      participants,
      ready,
      add,
      update,
      remove,
      toggleAgent,
      setActive,
      markUsed,
      byCode: (code) => participants.find((p) => p.code === code.trim().toUpperCase()),
      byId: (id) => participants.find((p) => p.id === id),
    }),
    [participants, ready, add, update, remove, toggleAgent, setActive, markUsed],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDirectory() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDirectory — только внутри DirectoryProvider");
  return ctx;
}

// ── Мелочи ────────────────────────────────────────────────────────────────────

/** Старая запись могла быть без новых полей — добиваем значениями по умолчанию. */
function normalize(p: Partial<Participant>): Participant {
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
  };
}

/** Ник приводим к одному виду: без собаки и без ссылки — её добавит интерфейс. */
export function cleanTelegram(raw: string): string {
  return raw.trim().replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "").trim();
}

const translitMap: Record<string, string> = {
  а: "A", б: "B", в: "V", г: "G", д: "D", е: "E", ё: "E", ж: "ZH", з: "Z", и: "I", й: "Y",
  к: "K", л: "L", м: "M", н: "N", о: "O", п: "P", р: "R", с: "S", т: "T", у: "U", ф: "F",
  х: "H", ц: "C", ч: "CH", ш: "SH", щ: "SCH", ъ: "", ы: "Y", ь: "", э: "E", ю: "YU", я: "YA",
};

const translit = (s: string) =>
  s
    .toLowerCase()
    .split("")
    .map((ch) => translitMap[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]/gi, "");

const rolePrefix: Record<Role, string> = { admin: "BV", project: "BV-PM", client: "BV" };

/** Код читается вслух и не повторяется: префикс, фамилия, при совпадении — номер. */
function uniqueCode(p: Participant, existing: Participant[]): string {
  const surname = translit(p.name.trim().split(/\s+/).pop() ?? "").toUpperCase() || "USER";
  const base = `${rolePrefix[p.role]}-${surname}`;
  const taken = new Set(existing.map((x) => x.code));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36).toUpperCase()}`;
}
