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
    if (!me || !text) return { windows: [] as StoredWindow[], note: "" };

    const q = await import("./server-queue");
    const key = `${me.id}:${data.windowId}`;

    // Тот же вопрос уже в работе: так бывает, когда у человека оборвалась
    // связь и он нажал «Отправить» ещё раз. Два ответа в одно окно пишут
    // один поверх другого — и переписка теряется. Лучше вежливо подождать.
    if (q.isAsking(key)) {
      return {
        windows: await d.readWindows(me.id),
        note: "Предыдущий вопрос ещё в работе — ответ появится сам, повторять не нужно.",
      };
    }

    // Очередь переполнена — честно говорим об этом, а не держим человека час.
    if (q.modelGate.full) {
      return {
        windows: await d.readWindows(me.id),
        note: "Сейчас к агентам очень много обращений. Подождите пару минут и отправьте вопрос снова.",
      };
    }

    let windows = await d.readWindows(me.id);

    const target = windows.find((w) => w.id === data.windowId);
    if (!target) return { windows, note: "" };

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
    q.startAsking(key);

    // Документы: постоянные у агента, принесённые в окно и прочитанные по ссылкам.
    const attachments = await attachmentsFor({
      agentId: target.agentId,
      personId: me.id,
      windowFiles: files,
    });

    let answer: { ok: true; text: string } | { ok: false; reason: string; detail?: string };

    // Секрет чужого сервиса читаем ДО очереди: в очереди уже не до файлов.
    const agentAuth = cfg?.transport === "http" ? await d.readAgentAuth(target.agentId) : "";

    try {
      // Через очередь: одновременных разговоров с моделью столько, сколько
      // она готова тянуть, остальные ждут. Ждать дольше лучше, чем получить
      // «слишком часто» вместо разбора.
      answer = await q.modelGate.run(async () => {
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
            auth: agentAuth,
            systemPrompt: cfg.prompt ?? "",
            history: target.messages,
            question: text,
            attachments,
          });
          return res.ok
            ? { ok: true as const, text: res.text }
            : { ok: false as const, reason: "failed", detail: res.detail };
        }

        const { askAgent } = await import("./server-llm");
        return askAgent({
          systemPrompt: cfg?.prompt ?? "",
          model: cfg?.model ?? "claude-opus-5",
          history: target.messages,
          question: text,
          attachments,
          label: `${target.agentId} · ${me.name}`,
        });
      });
    } finally {
      // Отпускаем человека в любом случае: иначе после сбоя он не сможет
      // задать вопрос до перезапуска сервиса.
      q.doneAsking(key);
    }

    const reply = answer.ok
      ? answer.text
      : answer.reason === "no-key"
        ? "Агент настроен, но ключ модели ещё не задан — администратор вписывает его в своей панели. Вопрос сохранён."
        : answer.reason === "not-configured"
          ? "Этому агенту ещё не задали инструкцию — администратор вписывает её в своей панели. Вопрос сохранён."
          : answer.reason === "busy"
            ? "Сейчас к агенту очередь: слишком много обращений разом. Вопрос сохранён — отправьте его ещё раз через минуту."
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
    return { windows: next, note: "" };
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
