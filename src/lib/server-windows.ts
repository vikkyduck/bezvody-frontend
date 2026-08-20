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

    const target = windows.find((w) => w.id === data.windowId);
    if (!target) return { windows };

    // Спрашиваем модель. Историю передаём ту, что была ДО этого вопроса.
    const cfgAll = await d.readJson<Record<string, { prompt: string; model: string }>>(
      `${d.dataDir()}/agents.json`,
      {},
    );
    const cfg = cfgAll[target.agentId];
    const { askAgent } = await import("./server-llm");
    const answer = await askAgent({
      systemPrompt: cfg?.prompt ?? "",
      model: cfg?.model ?? "claude-opus-5",
      history: target.messages,
      question: text,
    });

    const reply = answer.ok
      ? answer.text
      : answer.reason === "no-key"
        ? "Агент настроен, но ключ модели ещё не задан — администратор вписывает его в своей панели. Вопрос сохранён."
        : answer.reason === "not-configured"
          ? "Этому агенту ещё не задали инструкцию — администратор вписывает её в своей панели. Вопрос сохранён."
          : `Не удалось получить ответ: ${answer.detail ?? "ошибка связи с моделью"}. Вопрос сохранён — попробуйте ещё раз.`;

    const next = windows.map((w) => {
      if (w.id !== data.windowId) return w;
      const docs = answer.ok
        ? [
            ...w.docs,
            {
              id: rid("d"),
              title: w.messages.length === 0 ? shortTitle(text) : `Ответ от ${new Date().toLocaleDateString("ru-RU")}`,
              kind: "Разбор агента",
              at: stamp(),
            },
          ]
        : w.docs;
      return {
        ...w,
        title: w.messages.length === 0 ? shortTitle(text) : w.title,
        updatedAt: stamp(),
        docs,
        messages: [
          ...w.messages,
          { id: rid("m"), from: "user" as const, text, at: stamp() },
          { id: rid("m"), from: "agent" as const, text: reply, at: stamp() },
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
