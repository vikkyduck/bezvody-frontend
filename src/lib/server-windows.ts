/**
 * Окна разговоров на сервере.
 *
 * Переписка хранится у участника: файл на каждого человека, и достать её
 * может он сам либо администратор. Проджект в чужие разговоры не ходит —
 * его дело доступы, а не содержание работы.
 */
import { createServerFn } from "@tanstack/react-start";

import { shortTitle, type StoredWindow } from "./conversations";

const windowsFile = (dir: string, personId: string) => `${dir}/windows/${personId}.json`;

const stamp = () => new Date().toISOString();
const rid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

/** Свои окна — по коду. */
export const listWindowsServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }) => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { windows: [] as StoredWindow[] };
    return { windows: await d.readJson<StoredWindow[]>(windowsFile(d.dataDir(), me.id), []) };
  });

/** Открыть окно с агентом. Агент выбирается здесь и навсегда. */
export const openWindowServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; agentId: string; title: string }) => data)
  .handler(async ({ data }) => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { windows: [] as StoredWindow[], opened: null };

    // Агента можно открыть только из тех, что открыты этому человеку.
    if (!me.agentIds.includes(data.agentId)) {
      const windows = await d.readJson<StoredWindow[]>(windowsFile(d.dataDir(), me.id), []);
      return { windows, opened: null };
    }

    const file = windowsFile(d.dataDir(), me.id);
    const windows = await d.readJson<StoredWindow[]>(file, []);
    const opened: StoredWindow = {
      id: rid("w"),
      agentId: data.agentId,
      title: data.title || "Новый вопрос",
      messages: [],
      docs: [],
      createdAt: stamp(),
      updatedAt: stamp(),
    };
    const next = [opened, ...windows];
    await d.writeJson(file, next);
    return { windows: next, opened };
  });

export const sendMessageServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; windowId: string; text: string }) => data)
  .handler(async ({ data }) => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    const text = String(data.text ?? "").trim();
    if (!me || !text) return { windows: [] as StoredWindow[] };

    const file = windowsFile(d.dataDir(), me.id);
    const windows = await d.readJson<StoredWindow[]>(file, []);

    const next = windows.map((w) => {
      if (w.id !== data.windowId) return w;
      return {
        ...w,
        title: w.messages.length === 0 ? shortTitle(text) : w.title,
        updatedAt: stamp(),
        messages: [
          ...w.messages,
          { id: rid("m"), from: "user" as const, text, at: stamp() },
          {
            id: rid("m"),
            from: "agent" as const,
            // Настоящего ответа пока нет: агенты не подключены к платформе.
            // Здесь будет вызов бэкенда, и врать про работу мы не будем.
            text: "Агент ещё не подключён к платформе — ответить пока нечем. Вопрос сохранён в этом окне.",
            at: stamp(),
          },
        ],
      };
    });

    await d.writeJson(file, next);
    return { windows: next };
  });

export const deleteWindowServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; windowId: string }) => data)
  .handler(async ({ data }) => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { windows: [] as StoredWindow[] };

    const file = windowsFile(d.dataDir(), me.id);
    const windows = await d.readJson<StoredWindow[]>(file, []);
    const next = windows.filter((w) => w.id !== data.windowId);
    await d.writeJson(file, next);
    return { windows: next };
  });

/**
 * Чужие окна — только администратору. Это доступ к содержанию работы клиента,
 * поэтому роль проверяется явно и никакой другой роли сюда нельзя.
 */
export const readWindowsServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; personId: string }) => data)
  .handler(async ({ data }) => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me || me.role !== "admin") return { windows: [] as StoredWindow[] };
    return { windows: await d.readJson<StoredWindow[]>(windowsFile(d.dataDir(), data.personId), []) };
  });
