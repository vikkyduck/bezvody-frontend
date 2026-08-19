/**
 * Справочник участников на сервере.
 *
 * Раньше он лежал в localStorage — и это была ошибка: у администратора и
 * у клиента получались РАЗНЫЕ справочники, поэтому назначенный агент до
 * человека не доезжал. Теперь список один, лежит файлом на сервере в РФ,
 * и все видят одно и то же.
 *
 * Проверка прав простая и честная для модели «код = логин»: каждый запрос
 * приносит код звонящего, сервер сам находит по нему человека и решает,
 * что тому можно. Клиент видит только себя, проджект — список без чужих
 * кодов, администратор — всё.
 *
 * Чего здесь пока нет: срока жизни сессии и защиты от подбора кода.
 * Это придёт вместе с настоящим бэкендом (httpOnly-cookie, как в ФинДоходе).
 */
import { createServerFn } from "@tanstack/react-start";

import {
  cleanTelegram,
  normalize,
  seedParticipants,
  uniqueCode,
  withoutCode,
  type Participant,
  type ParticipantDraft,
  type Role,
} from "./participants";

// ── Хранилище ─────────────────────────────────────────────────────────────────
// Файл лежит ВНЕ папки приложения: деплой перезаписывает /opt/bezvody-front
// целиком с --delete, и данные внутри неё не пережили бы ни одной выкатки.

const dataDir = () => process.env["BV_DATA_DIR"]?.trim() || ".data";
const dataFile = () => `${dataDir()}/directory.json`;

async function readAll(): Promise<Participant[]> {
  const { readFile } = await import("node:fs/promises");
  try {
    const raw = await readFile(dataFile(), "utf8");
    const parsed = JSON.parse(raw) as Participant[];
    if (Array.isArray(parsed) && parsed.length) return parsed.map(normalize);
  } catch {
    /* файла ещё нет или он повреждён — начинаем со скелета */
  }
  return seedParticipants;
}

async function writeAll(list: Participant[]): Promise<void> {
  const { mkdir, writeFile, rename } = await import("node:fs/promises");
  await mkdir(dataDir(), { recursive: true });
  // Пишем через временный файл: обрыв на середине не оставит битый справочник.
  const tmp = `${dataFile()}.tmp`;
  await writeFile(tmp, JSON.stringify(list, null, 2), "utf8");
  await rename(tmp, dataFile());
}

const today = () => new Date().toLocaleDateString("ru-RU");

/** Кто звонит. Отозванный код не пускает никуда. */
async function whoIs(code: string): Promise<{ list: Participant[]; me: Participant | null }> {
  const list = await readAll();
  const me = list.find((p) => p.code && p.code === code.trim().toUpperCase() && p.active) ?? null;
  return { list, me };
}

/** Что видно этой роли: администратору — всё, проджекту — список без чужих кодов. */
function visibleTo(me: Participant, list: Participant[]): Participant[] {
  if (me.role === "admin") return list;
  if (me.role === "project") return list.map((p) => (p.id === me.id ? p : withoutCode(p)));
  return [me];
}

// ── Вход ──────────────────────────────────────────────────────────────────────

export const signInServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }) => {
    const code = String(data.code ?? "").trim().toUpperCase();
    if (!code) return { ok: false as const };

    const { list, me } = await whoIs(code);
    if (!me) return { ok: false as const };

    // Отмечаем вход: в админке видно, кому код выдали, а он им ни разу не воспользовался.
    await writeAll(list.map((p) => (p.id === me.id ? { ...p, lastUsedAt: today() } : p)));
    return { ok: true as const, me: { ...me, lastUsedAt: today() } };
  });

/** Кто я и что мне открыто — свежими данными, а не тем, что осело в браузере. */
export const meServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }) => {
    const { me } = await whoIs(String(data.code ?? ""));
    return { me };
  });

// ── Список ────────────────────────────────────────────────────────────────────

export const listServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }) => {
    const { list, me } = await whoIs(String(data.code ?? ""));
    if (!me) return { participants: [] as Participant[] };
    return { participants: visibleTo(me, list) };
  });

// ── Изменения ─────────────────────────────────────────────────────────────────

type Mutation =
  | { kind: "add"; draft: ParticipantDraft }
  | { kind: "update"; id: string; patch: Partial<Omit<Participant, "id" | "code">> }
  | { kind: "remove"; id: string }
  | { kind: "toggleAgent"; id: string; agentId: string }
  | { kind: "setActive"; id: string; active: boolean };

/** Кому что можно менять. Проджект ведёт клиентов, но людей не заводит. */
function allowed(role: Role, m: Mutation): boolean {
  if (role === "admin") return true;
  if (role === "project") return m.kind === "toggleAgent";
  return false;
}

export const mutateServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; mutation: Mutation }) => data)
  .handler(async ({ data }) => {
    const { list, me } = await whoIs(String(data.code ?? ""));
    const m = data.mutation;
    if (!me || !allowed(me.role, m)) {
      return { ok: false as const, participants: me ? visibleTo(me, list) : [] };
    }

    let next = list;
    let created: Participant | null = null;

    switch (m.kind) {
      case "add": {
        const draft = m.draft;
        created = normalize({
          id: `p-${Math.random().toString(36).slice(2, 9)}`,
          name: draft.name.trim(),
          position: (draft.position ?? "").trim(),
          company: (draft.company ?? "").trim(),
          email: (draft.email ?? "").trim(),
          telegram: cleanTelegram(draft.telegram ?? ""),
          role: draft.role,
          code: uniqueCode(draft.name, draft.role, list),
          agentIds: [],
          createdAt: today(),
          lastUsedAt: null,
          active: true,
        });
        next = [created, ...list];
        break;
      }
      case "update":
        next = list.map((p) =>
          p.id === m.id
            ? normalize({
                ...p,
                ...m.patch,
                ...(m.patch.telegram !== undefined ? { telegram: cleanTelegram(m.patch.telegram) } : {}),
              })
            : p,
        );
        break;
      case "remove":
        // Себя удалить нельзя: остаться без единственного администратора — значит
        // потерять вход в платформу насовсем.
        next = m.id === me.id ? list : list.filter((p) => p.id !== m.id);
        break;
      case "toggleAgent":
        next = list.map((p) =>
          p.id === m.id
            ? {
                ...p,
                agentIds: p.agentIds.includes(m.agentId)
                  ? p.agentIds.filter((x) => x !== m.agentId)
                  : [...p.agentIds, m.agentId],
              }
            : p,
        );
        break;
      case "setActive":
        next = list.map((p) => (p.id === m.id && p.id !== me.id ? { ...p, active: m.active } : p));
        break;
    }

    await writeAll(next);
    return { ok: true as const, participants: visibleTo(me, next), created };
  });
