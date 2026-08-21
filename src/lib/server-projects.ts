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
  .handler(async ({ data }): Promise<Workspace & { opened: string | null }> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { ...empty, opened: null };

    const { projects, windows } = await d.readWorkspace(me.id);
    if (projects.length >= MAX_PROJECTS) {
      return { projects, windows, opened: null };
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
    if (!target) return { projects, windows, error: "окно не найдено" };

    // Берём только из своей же папки: чужая задача — чужие материалы.
    const source = windows.find(
      (w) => w.projectId === target.projectId && w.messages.some((m) => m.id === data.messageId),
    );
    const message = source?.messages.find((m) => m.id === data.messageId);
    if (!source || !message || message.from !== "agent") {
      return { projects, windows, error: "этот разбор не нашёлся в папке" };
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
