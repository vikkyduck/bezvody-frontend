/**
 * Папки проектов на сервере.
 *
 * Папка принадлежит человеку и лежит рядом с его перепиской. Всё, что здесь
 * есть, — его: документы задачи, окна агентов, собранные разборы. Проджект в
 * чужие папки не ходит, как не ходит и в переписку.
 *
 * Документы задачи общие для всех окон папки — в этом и смысл: принесли один
 * раз, спрашивают всех. А вот разбор одного агента другому сам собой не
 * достаётся: его переносят руками, кнопкой «взять из проекта».
 */
import { createServerFn } from "@tanstack/react-start";

import type { StoredWindow } from "./conversations";
import {
  DEFAULT_PROJECT_TITLE,
  MAX_PROJECTS,
  cleanProjectTitle,
  isProjectOpen,
  type StoredProject,
} from "./projects";

const stamp = () => new Date().toISOString();
const rid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

/** Что клиент держит на экране: папки и окна вместе. */
export type Workspace = { projects: StoredProject[]; windows: StoredWindow[] };

const empty: Workspace = { projects: [], windows: [] };

/** Папки и окна одним куском — с переносом старых окон в папки. */
export const listWorkspaceServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }): Promise<Workspace> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return empty;
    return d.readWorkspace(me.id);
  });

export const createProjectServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; title: string }) => data)
  .handler(async ({ data }): Promise<Workspace & { opened: string | null; note?: string }> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me)
      return { ...empty, opened: null, note: "Кабинет вас не узнал — войдите по коду ещё раз." };

    const { projects, windows } = await d.readWorkspace(me.id);
    // Считаем только те, что в работе. Закрытые лежат в архиве и списку не
    // мешают — упираться из-за них в потолок значило бы наказывать человека
    // за то, что он закрывает сделанное, а это ровно то поведение, ради
    // которого закрытие и заводили.
    if (projects.filter(isProjectOpen).length >= MAX_PROJECTS) {
      // Упереться в предел — не то же самое, что потерять связь. Раньше отказ
      // выглядел как сбой сети, и человек жал «создать» снова и снова.
      return {
        projects,
        windows,
        opened: null,
        note: `Больше ${MAX_PROJECTS} задач в работе разом не держим — закончите сделанные или удалите ненужную.`,
      };
    }

    const project: StoredProject = {
      id: rid("p"),
      title: cleanProjectTitle(data.title) || DEFAULT_PROJECT_TITLE,
      files: [],
      createdAt: stamp(),
      updatedAt: stamp(),
    };
    const next = [project, ...projects];
    await d.writeProjects(me.id, next);
    return { projects: next, windows, opened: project.id };
  });

export const renameProjectServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; projectId: string; title: string }) => data)
  .handler(async ({ data }): Promise<Workspace> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return empty;

    const { projects, windows } = await d.readWorkspace(me.id);
    const title = cleanProjectTitle(data.title);
    // Безымянная папка в списке неотличима от соседней — пустое имя не берём.
    if (!title) return { projects, windows };

    const next = projects.map((p) =>
      p.id === data.projectId ? { ...p, title, updatedAt: stamp() } : p,
    );
    await d.writeProjects(me.id, next);
    return { projects: next, windows };
  });

/**
 * Сложить одну задачу в другую.
 *
 * Список задач у активного человека зарастает: демонстрационные заходы,
 * «Новый вопрос» на каждый быстрый вопрос, задачи, оказавшиеся одной и той же
 * работой. Убирать их удалением значит терять разговоры. Складывание ничего
 * не теряет: разговоры и документы переезжают в задачу-приёмник целиком,
 * а опустевшая оболочка исчезает — от неё оставалось только имя.
 */
export const mergeProjectServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; fromId: string; toId: string }) => data)
  .handler(async ({ data }): Promise<Workspace & { ok: boolean; note: string }> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me)
      return { ...empty, ok: false, note: "Кабинет вас не узнал — войдите по коду ещё раз." };

    const { projects, windows } = await d.readWorkspace(me.id);
    const from = projects.find((p) => p.id === data.fromId);
    const to = projects.find((p) => p.id === data.toId);
    // Сложить задачу саму в себя — жест мимо, а не намерение.
    if (!from || !to || from.id === to.id)
      return { projects, windows, ok: false, note: "Задача не нашлась — обновите страницу." };

    // Документы не задваиваем: один и тот же файл мог попасть в обе задачи.
    const seen = new Set(to.files.map((f) => f.id));
    const files = [...to.files, ...from.files.filter((f) => !seen.has(f.id))];

    // updatedAt окон не трогаем: переезд — не работа по разговору,
    // и всплывать в ленте от него разговоры не должны.
    const nextWindows = windows.map((w) =>
      w.projectId === from.id ? { ...w, projectId: to.id } : w,
    );
    const nextProjects = projects
      .filter((p) => p.id !== from.id)
      .map((p) => (p.id === to.id ? { ...p, files, updatedAt: stamp() } : p));

    await d.writeWindows(me.id, nextWindows);
    await d.writeProjects(me.id, nextProjects);
    return { projects: nextProjects, windows: nextWindows, ok: true, note: "" };
  });

/**
 * Закончить задачу — или вернуть её в работу.
 *
 * Соседнее удаление необратимо: оно уносит документы и разговоры, и человек им
 * не пользуется, чтобы разгрести список, — а список у активного человека к
 * третьему месяцу перестаёт читаться. Поэтому закрытие ничего не трогает:
 * задача целиком остаётся на диске, меняется только `closedAt`. Действие
 * дешёвое в обе стороны, и цена ошибки — один клик обратно.
 *
 * Права те же, что у переименования и удаления: чужие задачи закрывать нельзя,
 * даже руководителю — он их видит, но работает в них человек.
 */
export const closeProjectServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; projectId: string; closed: boolean }) => data)
  .handler(async ({ data }): Promise<Workspace & { ok: boolean; note: string }> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me)
      return { ...empty, ok: false, note: "Кабинет вас не узнал — войдите по коду ещё раз." };

    const { projects, windows } = await d.readWorkspace(me.id);
    const target = projects.find((p) => p.id === data.projectId);
    // Чужая задача или уже удалённая. Молчаливое «получилось» здесь хуже
    // отказа: человек уйдёт в уверенности, что задача закончена, а она нет.
    if (!target)
      return { projects, windows, ok: false, note: "Такая задача в вашем кабинете не нашлась." };

    const closed = Boolean(data.closed);
    const alreadyThere = isProjectOpen(target) === !closed;
    // Второй клик по той же кнопке или вторая вкладка: состояние уже нужное,
    // писать файл заново незачем — и незачем пугать человека отказом.
    if (alreadyThere) return { projects, windows, ok: true, note: "" };

    /**
     * Про `updatedAt` — по нему список сортируется, поэтому решаем осознанно и
     * по-разному в две стороны.
     *
     * Закрываем — не трогаем. Закрытие не работа по задаче, а признание, что
     * работа кончилась; проставь мы здесь свежую дату, потеряли бы день, когда
     * по задаче реально что-то делали. Хуже того, `visaOf` берёт максимум из
     * дат задачи и её разговоров, и в кабинете руководителя задача, закрытая
     * спустя полгода тишины, всплыла бы наверх как самая живая. А архиву своя
     * дата и не нужна: `closedAt` — это и есть «когда закончили».
     *
     * Возвращаем в работу — обновляем. Задача снова в ленте активных, и
     * человек только что сам её туда вернул: если она сядет двадцать второй
     * строкой по прошлогодней дате, действие выглядит как не сработавшее.
     * Всплывать наверх при повторном открытии — не искажение, а единственное
     * место, где человек её сейчас ищет.
     */
    const next = projects.map((p) =>
      p.id !== target.id
        ? p
        : closed
          ? { ...p, closedAt: stamp() }
          : { ...p, closedAt: null, updatedAt: stamp() },
    );
    await d.writeProjects(me.id, next);
    return { projects: next, windows, ok: true, note: "" };
  });

/**
 * Удалить папку — вместе с окнами и документами.
 *
 * Это разом уносит всю работу по задаче, поэтому подтверждение спрашивается
 * на экране, а здесь мы просто честно доводим дело до конца: оставить файлы
 * без папки — значит оставить мусор, который человек уже не найдёт.
 */
export const deleteProjectServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; projectId: string }) => data)
  .handler(async ({ data }): Promise<Workspace> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return empty;

    const { projects, windows } = await d.readWorkspace(me.id);
    const gone = projects.find((p) => p.id === data.projectId);
    if (!gone) return { projects, windows };

    const goneWindows = windows.filter((w) => w.projectId === data.projectId);
    const nextProjects = projects.filter((p) => p.id !== data.projectId);
    const nextWindows = windows.filter((w) => w.projectId !== data.projectId);
    await d.writeProjects(me.id, nextProjects);
    await d.writeWindows(me.id, nextWindows);

    const { forgetWindowFiles } = await import("./server-files");
    const files = [...gone.files, ...goneWindows.flatMap((w) => w.files)];
    if (files.length) await forgetWindowFiles(me.id, files);

    return { projects: nextProjects, windows: nextWindows };
  });

/**
 * Взять чужой разбор в это окно.
 *
 * Шестистраничник Архитектора нужен Стейкхолдерам целиком — не пересказом.
 * Кладём его в окно документом: агент прочитает как обычный файл, а человек
 * увидит в списке, что именно принесли. В папку он не попадает — это выбор
 * для одного разговора, а не для всех сразу.
 */
export const takeIntoWindowServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; windowId: string; messageId: string }) => data)
  .handler(async ({ data }): Promise<Workspace & { error: string }> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { ...empty, error: "нет доступа" };

    const { projects, windows } = await d.readWorkspace(me.id);
    const target = windows.find((w) => w.id === data.windowId);
    if (!target) return { projects, windows, error: "разговор не найден" };

    // Берём только из своей же папки: чужая задача — чужие материалы.
    const source = windows.find(
      (w) => w.projectId === target.projectId && w.messages.some((m) => m.id === data.messageId),
    );
    const message = source?.messages.find((m) => m.id === data.messageId);
    if (!source || !message || message.from !== "agent") {
      return { projects, windows, error: "этот разбор не нашёлся в задаче" };
    }

    const doc = source.docs.find((x) => x.messageId === data.messageId);
    const { saveTextAsFile } = await import("./server-files");
    const saved = await saveTextAsFile(me.id, `${doc?.title ?? source.title}.md`, message.text);

    const next = windows.map((w) =>
      w.id === target.id ? { ...w, files: [...w.files, saved], updatedAt: stamp() } : w,
    );
    await d.writeWindows(me.id, next);
    return { projects, windows: next, error: saved.note };
  });
