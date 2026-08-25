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
  uniqueCode,
  withoutCode,
  type Participant,
  type ParticipantDraft,
  type Role,
} from "./participants";

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
    const code = String(data.code ?? "")
      .trim()
      .toUpperCase();
    if (!code) return { ok: false as const };

    const d = await import("./server-data");
    const { list, me } = await d.whoIs(code);
    if (!me) return { ok: false as const };

    // Отмечаем вход: в админке видно, кому код выдали, а он им ни разу не воспользовался.
    await d.writeParticipants(
      list.map((p) => (p.id === me.id ? { ...p, lastUsedAt: d.today() } : p)),
    );
    return { ok: true as const, me: withWatched({ ...me, lastUsedAt: d.today() }, list) };
  });

/**
 * Видно ли работу этого человека кому-то из руководителей.
 *
 * Кабинет обещает, что код «открывает только ваши задачи и документы». С
 * появлением панели руководителя это перестало быть полной правдой, и человек
 * должен узнать об этом от нас, а не случайно. Признак считаем здесь и отдаём
 * вместе с кабинетом — интерфейс говорит о нём в подвале.
 */
function withWatched(me: Participant, list: Participant[]): Participant {
  if (me.role !== "client" || me.hidden) return { ...me, watched: false };
  const hasChief = list.some((p) => p.leads && p.active && p.id !== me.id);
  return { ...me, watched: hasChief };
}

/**
 * Куда присылать готовое — решает сам человек, а не администратор.
 *
 * Это его почта и его телеграм, и просить исполнителя переключить тумблер
 * было бы странно. Поэтому функция правит только СВОЮ запись: чужой id она
 * не принимает вовсе.
 */
export const setDeliveryServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; telegram: boolean; email: boolean }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; me: Participant | null; note: string }> => {
    const d = await import("./server-data");
    const { list, me } = await d.whoIs(String(data.code ?? ""));
    if (!me)
      return { ok: false, me: null, note: "Кабинет вас не узнал — войдите по коду ещё раз." };

    // Почта включается только когда есть куда слать: тумблер без адреса —
    // обещание, которое платформа не сдержит.
    const email = data.email && Boolean(me.email.trim());
    const next = list.map((p) =>
      p.id === me.id ? normalize({ ...p, deliver: { telegram: data.telegram, email } }) : p,
    );
    await d.writeParticipants(next);
    const fresh = next.find((p) => p.id === me.id) ?? me;
    return {
      ok: true,
      me: withWatched(fresh, next),
      note:
        data.email && !email
          ? "Почта в вашей карточке не записана — попросите менеджера её вписать."
          : "",
    };
  });

/** Кто я и что мне открыто — свежими данными, а не тем, что осело в браузере. */
export const meServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }) => {
    const d = await import("./server-data");
    const { list, me } = await d.whoIs(String(data.code ?? ""));
    return { me: me ? withWatched(me, list) : me };
  });

// ── Список ────────────────────────────────────────────────────────────────────

export const listServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }) => {
    const d = await import("./server-data");
    const { list, me } = await d.whoIs(String(data.code ?? ""));
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
    const d = await import("./server-data");
    const { list, me } = await d.whoIs(String(data.code ?? ""));
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
          createdAt: d.today(),
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
                ...(m.patch.telegram !== undefined
                  ? { telegram: cleanTelegram(m.patch.telegram) }
                  : {}),
              })
            : p,
        );
        break;
      case "remove":
        // Себя удалить нельзя: остаться без единственного администратора — значит
        // потерять вход в платформу насовсем.
        if (m.id !== me.id) {
          next = list.filter((p) => p.id !== m.id);
          // Вместе с кабинетом уходят и задачи, и переписка, и принесённые
          // документы: держать чужие материалы после удаления человека незачем —
          // ни нам, ни по 152-ФЗ. Задачи лежат отдельным файлом от разговоров
          // (см. server-data.ts), и без этой строки подтверждение на экране
          // обещало удалить их, а на диске они оставались.
          // id перед подстановкой в путь чистим: он приходит извне.
          const who = m.id.replace(/[^a-zA-Z0-9_-]/g, "");
          if (who) {
            const { rm } = await import("node:fs/promises");
            await rm(`${d.dataDir()}/projects/${who}.json`, { force: true });
            await rm(`${d.dataDir()}/windows/${who}.json`, { force: true });
            await rm(`${d.dataDir()}/files/w/${who}`, { recursive: true, force: true });
          }
        }
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

    await d.writeParticipants(next);
    return { ok: true as const, participants: visibleTo(me, next), created };
  });
