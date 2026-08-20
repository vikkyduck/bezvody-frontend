/**
 * Окна разговоров на сервере.
 *
 * Переписка хранится у участника: файл на каждого человека, и достать её
 * может он сам либо администратор. Проджект в чужие разговоры не ходит —
 * его дело доступы, а не содержание работы.
 */
import { createServerFn } from "@tanstack/react-start";

import { shortTitle, type StoredWindow } from "./conversations";

const stamp = () => new Date().toISOString();
const rid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

/** Свои окна — по коду. */
export const listWindowsServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }) => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { windows: [] as StoredWindow[] };
    return { windows: await d.readWindows(me.id) };
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
      return { windows: await d.readWindows(me.id), opened: null };
    }

    const windows = await d.readWindows(me.id);
    const opened: StoredWindow = {
      id: rid("w"),
      agentId: data.agentId,
      title: data.title || "Новый вопрос",
      messages: [],
      docs: [],
      files: [],
      createdAt: stamp(),
      updatedAt: stamp(),
    };
    const next = [opened, ...windows];
    await d.writeWindows(me.id, next);
    return { windows: next, opened };
  });

export const sendMessageServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; windowId: string; text: string }) => data)
  .handler(async ({ data }) => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    const text = String(data.text ?? "").trim();
    if (!me || !text) return { windows: [] as StoredWindow[] };

    let windows = await d.readWindows(me.id);

    const target = windows.find((w) => w.id === data.windowId);
    if (!target) return { windows };

    // Ссылки из вопроса читаем ДО того, как спросить агента: он должен
    // получить документ, а не отвечать «доступа к внешним файлам у меня нет».
    // Сохраняем сразу — тогда прочитанное останется в окне, даже если модель
    // потом не ответит.
    const { attachmentsFor, readLinks } = await import("./server-files");
    const fromLinks = await readLinks({ text, personId: me.id, already: target.files });
    let files = target.files;
    if (fromLinks.length) {
      files = [...files, ...fromLinks];
      windows = windows.map((w) => (w.id === target.id ? { ...w, files, updatedAt: stamp() } : w));
      await d.writeWindows(me.id, windows);
    }

    // Спрашиваем модель. Историю передаём ту, что была ДО этого вопроса.
    const cfgAll = await d.readJson<
      Record<
        string,
        {
          prompt: string;
          model: string;
          transport?: "model" | "http";
          endpoint?: string;
          authHeader?: string;
          format?: "openai" | "simple";
        }
      >
    >(
      `${d.dataDir()}/agents.json`,
      {},
    );
    const cfg = cfgAll[target.agentId];

    // Документы: постоянные у агента, принесённые в окно и прочитанные по ссылкам.
    const attachments = await attachmentsFor({
      agentId: target.agentId,
      personId: me.id,
      windowFiles: files,
    });

    let answer: { ok: true; text: string } | { ok: false; reason: string; detail?: string };

    if (cfg?.transport === "http") {
      // Агент живёт за вашим сервисом — идём туда, а не к модели напрямую.
      const { callHttpAgent } = await import("./server-http-agent");
      const res = await callHttpAgent({
        settings: {
          endpoint: cfg.endpoint ?? "",
          authHeader: cfg.authHeader ?? "Authorization",
          format: cfg.format ?? "openai",
          ...(cfg.model ? { model: cfg.model } : {}),
        },
        auth: await d.readAgentAuth(target.agentId),
        systemPrompt: cfg.prompt ?? "",
        history: target.messages,
        question: text,
        attachments,
      });
      answer = res.ok ? { ok: true, text: res.text } : { ok: false, reason: "failed", detail: res.detail };
    } else {
      const { askAgent } = await import("./server-llm");
      answer = await askAgent({
        systemPrompt: cfg?.prompt ?? "",
        model: cfg?.model ?? "claude-opus-5",
        history: target.messages,
        question: text,
        attachments,
      });
    }

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

    await d.writeWindows(me.id, next);
    return { windows: next };
  });

export const deleteWindowServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; windowId: string }) => data)
  .handler(async ({ data }) => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { windows: [] as StoredWindow[] };

    const windows = await d.readWindows(me.id);
    const next = windows.filter((w) => w.id !== data.windowId);
    await d.writeWindows(me.id, next);

    // Вместе с окном уносим и его документы: они относились к этой задаче.
    const gone = windows.find((w) => w.id === data.windowId);
    if (gone?.files.length) {
      const { forgetWindowFiles } = await import("./server-files");
      await forgetWindowFiles(me.id, gone.files);
    }
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
    return { windows: await d.readWindows(data.personId) };
  });
