/**
 * Окна разговоров на сервере.
 *
 * Переписка хранится у участника: файл на каждого человека, и достать её
 * может он сам либо администратор. Проджект в чужие разговоры не ходит —
 * его дело доступы, а не содержание работы.
 */
import { createServerFn } from "@tanstack/react-start";

import { shortTitle, type StoredWindow } from "./conversations";
import type { StoredProject } from "./projects";
import { ROLE_OPENING, ROLE_VERDICT } from "./roles";
import { roleById, rolesOf, systemPromptOf, type AgentConfig } from "./server-agents";
import type { AttachmentsFit } from "./server-files";

const stamp = () => new Date().toISOString();
/** Окно ещё не назвали по-человечески: имя дал не участник, а платформа. */
const isDefaultTitle = (t: string) => !t.trim() || t.trim() === "Новый вопрос";
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

/**
 * Что вернулось на просьбу открыть разговор.
 *
 * note — причина отказа человеческими словами. Отказать можно по-разному
 * (нет сессии, агент не открыт, задача пропала), а на экране это выглядело
 * одинаково: карточка агента молча не срабатывает, и человек жмёт ещё раз.
 */
type OpenResult = { windows: StoredWindow[]; opened: StoredWindow | null; note?: string };

/**
 * Открыть разговор с агентом внутри задачи. Агент выбирается здесь и навсегда.
 *
 * По умолчанию продолжаем последний разговор с этим агентом в этой задаче.
 * Карточка агента — единственный заметный путь «вернуться к агенту», и если
 * каждый заход заводит пустое окно, человек решает, что переписка пропала.
 * Новый разговор заводим только тогда, когда его попросили явно: fresh.
 */
export const openWindowServer = createServerFn({ method: "POST" })
  .validator(
    (data: {
      code: string;
      agentId: string;
      projectId: string;
      title: string;
      /** true — начать разговор с нуля; по умолчанию продолжаем последний */
      fresh?: boolean;
    }) => data,
  )
  .handler(async ({ data }): Promise<OpenResult> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me)
      return {
        windows: [] as StoredWindow[],
        opened: null,
        note: "Кабинет вас не узнал — войдите по коду ещё раз.",
      };

    // Агента можно открыть только из тех, что открыты этому человеку.
    if (!me.agentIds.includes(data.agentId)) {
      return {
        windows: await d.readWindows(me.id),
        opened: null,
        note: "Этого агента вам сейчас не открыли — напишите менеджеру.",
      };
    }

    const { projects, windows } = await d.readWorkspace(me.id);
    // Окно живёт в папке: без папки его документы негде взять.
    if (!projects.some((p) => p.id === data.projectId))
      return { windows, opened: null, note: "Задача не найдена — обновите страницу." };

    if (!data.fresh) {
      // Ранжируем в два ключа: сначала разговоры, где действительно говорили,
      // и только потом по времени. Пустое окно, открытое вчера и брошенное,
      // бывает свежее настоящей переписки — и человек, нажав «продолжить»,
      // попадал в пустоту и решал, что его работа пропала. Пустой берём,
      // только если непустых нет вовсе.
      const better = (w: StoredWindow, best: StoredWindow) => {
        const has = w.messages.length > 0;
        const bestHas = best.messages.length > 0;
        if (has !== bestHas) return has;
        return w.updatedAt > best.updatedAt;
      };
      const previous = windows
        .filter((w) => w.agentId === data.agentId && w.projectId === data.projectId)
        .reduce<StoredWindow | null>((best, w) => (!best || better(w, best) ? w : best), null);
      if (previous) return { windows, opened: previous };
    }

    const opened: StoredWindow = {
      id: rid("w"),
      agentId: data.agentId,
      projectId: data.projectId,
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

/**
 * Сказать человеку, что агент прочитал не всё.
 *
 * До сих пор об этом знала только модель: в её запрос уходила приписка
 * «документ обрезан», а на экране файл оставался обычным принятым документом.
 * Человек решает по разбору, и он должен знать, по какой части документа этот
 * разбор сделан. Пусто — значит поместилось всё, и говорить нечего.
 */
function unreadNote(fit: AttachmentsFit): string {
  const list = (names: string[]) => names.map((n) => `«${n}»`).join(", ");
  const parts: string[] = [];
  if (fit.trimmed.length)
    parts.push(`${list(fit.trimmed)} ${fit.trimmed.length > 1 ? "уехали" : "уехал"} частично`);
  if (fit.skipped.length)
    parts.push(`${list(fit.skipped)} не ${fit.skipped.length > 1 ? "уехали" : "уехал"} вовсе`);
  if (!parts.length) return "";
  return `Агент прочитал не всё: ${parts.join("; ")}. Уберите лишние документы из задачи и спросите снова.`;
}

/**
 * Сказать человеку, почему ответ шёл дольше обычного.
 *
 * Большой документ агент теперь не обрезает, а читает в несколько заходов —
 * и это честно занимает минуты. Без объяснения долгое ожидание выглядит
 * зависшей страницей, и человек уходит, не дождавшись разбора.
 */
function inPartsNote(names: string[]): string {
  if (!names.length) return "";
  const list = names.map((n) => `«${n}»`).join(", ");
  return names.length > 1
    ? `Документы ${list} большие — прочитал их по частям, это заняло дольше обычного.`
    : `Документ ${list} большой — прочитал его по частям, это заняло дольше обычного.`;
}

/**
 * Первую и последнюю реплику пишет платформа, а не человек: роль должна сама
 * открыть разговор по документу и сама закончить вердиктом. Слова эти нужны
 * в двух местах — когда роль открывают руками и когда по составу идёт прогон, —
 * поэтому выбираются здесь, одним правилом на оба пути.
 */
const textFor = (kind: "chat" | "open" | "verdict" | undefined, raw: string): string =>
  kind === "open" ? ROLE_OPENING : kind === "verdict" ? ROLE_VERDICT : String(raw ?? "").trim();

/** Кто спрашивает. Больше от участника здесь ничего не нужно. */
type Asker = { id: string; name: string };

/**
 * Ключ «этот человек занят этим разговором» для server-queue.
 *
 * Собирается в одном месте, потому что читают его теперь трое: одиночный
 * вопрос, прогон по составу и список «что сейчас в работе». Разойдись эти
 * ключи хоть на двоеточие — защита от двойного вопроса перестанет работать
 * молча, и человек получит два ответа поверх друг друга.
 */
const askKey = (personId: string, windowId: string) => `${personId}:${windowId}`;

/**
 * Один заход к агенту в одном разговоре: вопрос уходит, ответ ложится в окно.
 *
 * Живёт отдельной функцией, потому что путей сюда теперь два: человек спросил
 * сам и прогон по составу согласующих. Раньше всё это было расписано прямо в
 * обработчике, и стоило появиться второму пути, как правило завершения,
 * подгонка документов и учёт недочитанного разъехались бы между «одиночным»
 * вопросом и прогоном — а расходятся такие вещи молча и обнаруживаются на
 * чужом разборе.
 *
 * Правило «один вопрос в одно окно» (isAsking) держит ВЫЗЫВАЮЩИЙ, а не эта
 * функция: одиночный вопрос — на время своего захода, прогон — на весь прогон
 * целиком. Иначе между двумя ролями в разговор успевал бы влезть посторонний
 * вопрос, и ответы легли бы друг на друга.
 *
 * ok — ответил ли агент на самом деле. Реплика в окне появляется в любом
 * случае: неудачу тоже сохраняем текстом, чтобы вопрос не пропал бесследно.
 */
async function askInWindow(opts: {
  me: Asker;
  windowId: string;
  /** Уже готовый текст реплики — см. textFor */
  text: string;
  /** С какой ролью говорим — у агента с ролями */
  roleId?: string;
  /** open — роль читает документ и начинает; verdict — подводит итог */
  kind?: "chat" | "open" | "verdict";
}): Promise<{ ok: boolean; windows: StoredWindow[]; note: string }> {
  const d = await import("./server-data");
  const { me, text } = opts;
  if (!text) return { ok: false, windows: [] as StoredWindow[], note: "" };

  const q = await import("./server-queue");

  const workspace = await d.readWorkspace(me.id);
  const windows = workspace.windows;

  const target = windows.find((w) => w.id === opts.windowId);
  if (!target) return { ok: false, windows, note: "" };
  const project = workspace.projects.find((p) => p.id === target.projectId) ?? null;

  // Ссылки из вопроса читаем ДО того, как спросить агента: он должен
  // получить документ, а не отвечать «доступа к внешним файлам у меня нет».
  // Сохраняем сразу — тогда прочитанное останется в окне, даже если модель
  // потом не ответит.
  const { attachmentsFor, readLinks } = await import("./server-files");
  // Уже принесённое — и общее по задаче, и своё оконное: одну ссылку дважды
  // не качаем.
  const already = [...(project?.files ?? []), ...target.files];
  const fromLinks = await readLinks({ text, personId: me.id, already });
  // Присланное ссылкой — материал задачи, а не одного разговора: кладём в
  // папку, чтобы следующий агент не спрашивал того же самого.
  let projectFiles = project?.files ?? [];
  if (fromLinks.length && project) {
    projectFiles = [...projectFiles, ...fromLinks];
    await d.writeProjects(
      me.id,
      workspace.projects.map((p) =>
        p.id === project.id ? { ...p, files: projectFiles, updatedAt: stamp() } : p,
      ),
    );
  }

  // Спрашиваем модель. Историю передаём ту, что была ДО этого вопроса.
  const cfgAll = await d.readJson<Record<string, Partial<AgentConfig>>>(
    `${d.dataDir()}/agents.json`,
    {},
  );
  const cfg = cfgAll[target.agentId];
  // Роль берём на сервере по её ключу: из браузера приходит только ключ,
  // инструкции ролей туда не уезжают.
  const role = opts.roleId ? roleById(rolesOf(target.agentId, cfg), opts.roleId) : null;
  // Инструкция агента плюс правило завершения: команда должна получить
  // документ, а не переписку с уточнениями. У роли правило своё — разговор.
  const systemPrompt = systemPromptOf(cfg, role);

  // История — только та, что шла с этой же ролью. Разговоры с разными
  // ролями в одном окне не смешиваются: каждая читает документ своими глазами.
  const history = role
    ? target.messages.filter((m) => m.roleId === role.id)
    : target.messages.filter((m) => !m.roleId);

  // Документы: постоянные у агента, принесённые в окно и прочитанные по ссылкам.
  const packed = await attachmentsFor({
    agentId: target.agentId,
    personId: me.id,
    windowFiles: [...projectFiles, ...target.files],
  });
  let attachments = packed.items;

  // Что случилось с документами по дороге к модели: какие пришлось читать по
  // частям и что всё-таки не поместилось. И то и другое человеку говорим.
  let fit: { inParts: string[]; trimmed: string[] } = { inParts: [], trimmed: [] };

  const model = cfg?.model ?? "claude-opus-5";
  const label = `${target.agentId}${role ? `/${role.id}` : ""} · ${me.name}`;

  // Секрет чужого сервиса читаем ДО очереди: в очереди уже не до файлов.
  const agentAuth = cfg?.transport === "http" ? await d.readAgentAuth(target.agentId) : "";

  // Прежде чем встать в очередь: влезает ли вопрос с документами в окно
  // модели, и если нет — дочитываем большие документы по частям.
  //
  // Именно до очереди, а не внутри неё. Части читаются через ту же очередь
  // к модели; запрос, который держит слот и ждёт свободного слота, не
  // дождётся его никогда — при шести занятых слотах всё встало бы намертво.
  //
  // Считать умеем только для Claude: у GPT с Gemini окна свои, а за чужим
  // сервисом (transport http) вообще неизвестно, что за модель.
  if (cfg?.transport !== "http" && (cfg?.provider ?? "anthropic") === "anthropic") {
    try {
      const { fitForModel } = await import("./server-llm");
      const fitted = await fitForModel({
        systemPrompt,
        model,
        history,
        question: text,
        attachments,
        agentId: target.agentId,
        label,
      });
      attachments = fitted.attachments;
      fit = { inParts: fitted.inParts, trimmed: fitted.trimmed };
    } catch (err) {
      // Подгонка сорвалась — вопрос из-за этого не теряем: отправляем как
      // собрали. Хуже всего было бы ответить человеку ошибкой на этапе,
      // который вообще-то нужен только для того, чтобы ему помочь.
      console.error(
        `[агент] ${label} · не вышло примерить запрос к окну: ` +
          (err instanceof Error ? err.message.slice(0, 200) : "неизвестная ошибка"),
      );
    }
  }

  // Через очередь: одновременных разговоров с моделью столько, сколько
  // она готова тянуть, остальные ждут. Ждать дольше лучше, чем получить
  // «слишком часто» вместо разбора.
  const answer: { ok: true; text: string } | { ok: false; reason: string; detail?: string } =
    await q.modelGate.run(async () => {
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
          systemPrompt,
          history,
          question: text,
          attachments,
        });
        return res.ok
          ? { ok: true as const, text: res.text }
          : { ok: false as const, reason: "failed", detail: res.detail };
      }

      const { askAgent } = await import("./server-llm");
      return askAgent({
        systemPrompt,
        model,
        ...(cfg?.provider ? { provider: cfg.provider } : {}),
        agentId: target.agentId,
        history,
        question: text,
        attachments,
        label,
      });
    });

  const reply = answer.ok
    ? answer.text
    : answer.reason === "no-key"
      ? `Агент настроен, но ключ модели${answer.detail ? ` ${answer.detail}` : ""} ещё не задан — администратор вписывает его в своей панели. Вопрос сохранён.`
      : answer.reason === "not-configured"
        ? "Этому агенту ещё не задали инструкцию — администратор вписывает её в своей панели. Вопрос сохранён."
        : answer.reason === "busy"
          ? "Сейчас к агенту очередь: слишком много обращений разом. Вопрос сохранён — отправьте его ещё раз через минуту."
          : `Не удалось получить ответ: ${answer.detail ?? "ошибка связи с моделью"}. Вопрос сохранён — попробуйте ещё раз.`;

  // Id реплики придумываем заранее: по нему потом собирается файл Word.
  const answerId = rid("m");

  // Что агент не дочитал — считаем до сборки ответа: приписка живёт на самом
  // сообщении. Раньше она жила только в летучей полосе разговора и в прогоне
  // по составу не показывалась вовсе (см. console.warn ниже по вызову) —
  // человек не узнавал, что вердикт вынесен по половине документа.
  const unread = unreadNote({
    trimmed: [...packed.fit.trimmed, ...fit.trimmed],
    skipped: packed.fit.skipped,
  });

  const next = windows.map((w) => {
    if (w.id !== opts.windowId) return w;
    const docs = answer.ok
      ? [
          ...w.docs,
          {
            id: rid("d"),
            title: role
              ? `${role.name} — ${opts.kind === "verdict" ? "вердикт" : "разбор"}`
              : w.messages.length === 0
                ? shortTitle(text)
                : `Ответ от ${new Date().toLocaleDateString("ru-RU")}`,
            kind: role ? "Разговор с ролью" : "Разбор агента",
            at: stamp(),
            messageId: answerId,
          },
        ]
      : w.docs;
    return {
      ...w,
      // Заголовок окна с ролями — имя документа, который прогоняют: реплика
      // «посмотри материалы» в списке окон не говорит ни о чём.
      title: role
        ? isDefaultTitle(w.title)
          ? shortTitle(projectFiles[0]?.name ?? target.files[0]?.name ?? w.title)
          : w.title
        : w.messages.length === 0
          ? shortTitle(text)
          : w.title,
      updatedAt: stamp(),
      docs,
      messages: [
        ...w.messages,
        {
          id: rid("m"),
          from: "user" as const,
          text,
          at: stamp(),
          ...(role ? { roleId: role.id } : {}),
        },
        {
          id: answerId,
          from: "agent" as const,
          text: reply,
          at: stamp(),
          ...(role ? { roleId: role.id } : {}),
          ...(answer.ok && unread ? { note: unread } : {}),
        },
      ],
    };
  });

  await d.writeWindows(me.id, next);

  /**
   * Задача, так и не получившая имени, называется по первому настоящему
   * разговору. Раньше окно переименовывалось, а задача так и оставалась
   * «Новым вопросом» — и список задач на стартовой зарастал строками,
   * не говорящими ничего. Свежие проекты, которые человек назвал сам,
   * не трогаем: его имя всегда важнее выведенного.
   */
  const junkTitle = (t: string) =>
    !t.trim() || ["Новая задача", "Новый вопрос", "Первая задача"].includes(t.trim());
  const retitled = next.find((w) => w.id === opts.windowId);
  if (project && retitled && junkTitle(project.title) && !isDefaultTitle(retitled.title)) {
    const fresh = await d.readWorkspace(me.id);
    await d.writeProjects(
      me.id,
      fresh.projects.map((p) =>
        p.id === project.id ? { ...p, title: retitled.title, updatedAt: stamp() } : p,
      ),
    );
  }

  /**
   * Готовый разбор — в телеграм и почту, если человек это включил.
   *
   * Только настоящий документ: служебные реплики про очередь и ключи —
   * шум, за которым потеряется то единственное письмо, которого ждут.
   * Fire-and-forget: упавшая доставка не имеет права стоить человеку ответа.
   */
  if (answer.ok && (reply.trim().length >= 600 || /^#{1,3}\s/m.test(reply))) {
    const { deliverAnswer } = await import("./server-deliver");
    const { agentById } = await import("./shtab-data");
    const speaker = role ? role.name : (agentById(target.agentId)?.name ?? "Агент");
    void deliverAnswer({
      personId: me.id,
      windowId: opts.windowId,
      messageId: answerId,
      taskTitle: project?.title || target.title || "Ваша задача",
      speaker,
    });
  }

  // Полоса в разговоре одна, поэтому всё, что нужно сказать, складываем в
  // один note и дописываем к сказанному, а не подменяем его.
  const said: string[] = [];
  if (unread) said.push(unread);
  const parts = inPartsNote(fit.inParts);
  if (parts) said.push(parts);
  return { ok: answer.ok, windows: next, note: said.join(" ") };
}

export const sendMessageServer = createServerFn({ method: "POST" })
  .validator(
    (data: {
      code: string;
      windowId: string;
      text: string;
      /** С какой ролью говорим — у агента с ролями */
      roleId?: string;
      /** open — роль читает документ и начинает; verdict — подводит итог */
      kind?: "chat" | "open" | "verdict";
    }) => data,
  )
  .handler(async ({ data }): Promise<{ windows: StoredWindow[]; note: string }> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    const text = textFor(data.kind, String(data.text ?? ""));
    if (!me || !text) return { windows: [] as StoredWindow[], note: "" };

    const q = await import("./server-queue");
    const key = askKey(me.id, data.windowId);

    // Тот же вопрос уже в работе: так бывает, когда у человека оборвалась
    // связь и он нажал «Отправить» ещё раз. Два ответа в одно окно пишут
    // один поверх другого — и переписка теряется. Лучше вежливо подождать.
    // Сюда же попадает вопрос, заданный посреди прогона по составу: прогон
    // держит этот же ключ, пока не обойдёт весь состав.
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

    q.startAsking(key);
    try {
      const res = await askInWindow({
        me,
        windowId: data.windowId,
        text,
        ...(data.roleId ? { roleId: data.roleId } : {}),
        ...(data.kind ? { kind: data.kind } : {}),
      });
      return { windows: res.windows, note: res.note };
    } finally {
      // Отпускаем человека в любом случае: иначе после сбоя он не сможет
      // задать вопрос до перезапуска сервиса.
      q.doneAsking(key);
    }
  });

// ── Состав согласующих ────────────────────────────────────────────────────────
// Человек набирает состав тех, кто будет решение согласовывать, и прогоняет
// документ по всему составу разом. Раньше он ходил к каждой роли поодиночке:
// нажал роль — подождал минуты — нажал следующую. Семь ролей складывались в
// полчаса сидения у экрана, и до конца доходили немногие.

/** Эта роль уже высказалась в этом разговоре — значит, звать её заново незачем. */
const spokeAlready = (w: StoredWindow, roleId: string) =>
  w.messages.some((m) => m.from === "agent" && m.roleId === roleId);

/** «одна роль», «две роли», «пять ролей» — иначе платформа говорит как робот. */
function roleWord(n: number): string {
  const tail = n % 10;
  const hundred = n % 100;
  if (hundred >= 11 && hundred <= 14) return "ролей";
  if (tail === 1) return "роль";
  if (tail >= 2 && tail <= 4) return "роли";
  return "ролей";
}

/**
 * Набрать состав согласующих для разговора.
 *
 * Состав хранится у разговора (см. StoredWindow.panel): один документ несут
 * финансам и коммерческому, другой — логистике и категории, и общий состав
 * на всю задачу означал бы поход по чужим людям.
 */
export const setPanelServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; windowId: string; roleIds: string[] }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; windows: StoredWindow[]; note: string }> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me)
      return { ok: false, windows: [], note: "Кабинет вас не узнал — войдите по коду ещё раз." };

    const windows = await d.readWindows(me.id);
    // Разговор ищем среди своих: чужой состав не набирают даже случайно.
    const target = windows.find((w) => w.id === data.windowId);
    if (!target) return { ok: false, windows, note: "Разговор не найден — обновите страницу." };

    const runs = await import("./server-runs");
    // Менять состав посреди прогона нельзя: прогон идёт по списку, снятому на
    // старте, и человек видел бы, как «7 из 5» — счёт, которому нет объяснения.
    if (runs.isPanelRunning(data.windowId)) {
      return {
        ok: false,
        windows,
        note: "Состав сейчас идёт по документу — дождитесь конца, потом меняйте.",
      };
    }

    const cfgAll = await d.readJson<Record<string, Partial<AgentConfig>>>(
      `${d.dataDir()}/agents.json`,
      {},
    );
    const roles = rolesOf(target.agentId, cfgAll[target.agentId]);
    const wanted = new Set((Array.isArray(data.roleIds) ? data.roleIds : []).map(String));
    // Идём по ролям агента, а не по присланному списку. Отсюда сразу три вещи:
    // роль, которой у агента нет, отваливается молча (страница могла остаться
    // открытой со вчерашней настройки — ругаться на человека тут не за что);
    // повторы схлопываются; порядок остаётся тот, что задал методолог, а он
    // неслучаен — по лестнице ходят снизу вверх, с подготовленной позицией на
    // каждой ступени, и прогон идёт в том же порядке.
    const panel = roles.filter((r) => wanted.has(r.id)).map((r) => r.id);

    const next = windows.map((w) =>
      w.id === data.windowId ? { ...w, panel, updatedAt: stamp() } : w,
    );
    await d.writeWindows(me.id, next);

    // Выбрали кого-то, а в составе пусто — значит, у агента этих ролей больше
    // нет вовсе. Промолчать здесь нельзя: человек уйдёт с экрана уверенным,
    // что состав набран.
    const note =
      wanted.size && !panel.length
        ? "Этих согласующих у агента больше нет — обновите страницу и наберите состав заново."
        : "";
    return { ok: true, windows: next, note };
  });

/**
 * Прогнать документ по всему составу — фоном.
 *
 * Возвращаемся сразу, не дожидаясь агента: заход к одной роли идёт минуты, а
 * состав — это те же минуты, помноженные на семь. Держать столько открытым
 * запрос из браузера нельзя, связь оборвётся раньше первого ответа. Поэтому
 * ответ здесь означает «прогон начат», а не «прогон закончен»; как он идёт,
 * рассказывает panelStateServer.
 *
 * Роли идут по одной и каждая через общую очередь к модели (modelGate). Пустить
 * их разом было заманчиво — семь ответов за время одного, — но семь заходов
 * заняли бы все слоты очереди, и остальные клиенты платформы встали бы ждать
 * чужой прогон.
 */
export const runPanelServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; windowId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; note: string }> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { ok: false, note: "Кабинет вас не узнал — войдите по коду ещё раз." };

    const q = await import("./server-queue");
    const runs = await import("./server-runs");
    const key = askKey(me.id, data.windowId);

    const { projects, windows } = await d.readWorkspace(me.id);
    const target = windows.find((w) => w.id === data.windowId);
    if (!target) return { ok: false, note: "Разговор не найден — обновите страницу." };

    const panel = target.panel ?? [];
    if (!panel.length)
      return {
        ok: false,
        note: "Состав согласующих ещё не набран — отметьте, кому вы понесёте этот документ.",
      };

    const going = runs.panelRunOf(data.windowId);
    if (going) {
      const mins = runs.minutesSince(going.startedAt);
      return {
        ok: false,
        note: `Состав уже идёт по документу${mins ? `, ${mins}-я минута` : ""} — ответы появятся сами, запускать второй раз не нужно.`,
      };
    }
    // В разговоре пишется одиночный ответ. Пустить поверх него прогон — значит
    // получить два ответа в одно окно, второй поверх первого.
    if (q.isAsking(key))
      return {
        ok: false,
        note: "В этом разговоре ещё пишется ответ — дождитесь его и запустите состав.",
      };

    // Документа нет — прогон был бы получасом вежливых отказов: по общему
    // правилу роль обязана сказать, что материалов нет, и на этом закончить.
    const project = projects.find((p) => p.id === target.projectId) ?? null;
    if (!(project?.files.length ?? 0) && !target.files.length)
      return {
        ok: false,
        note: "К задаче не приложен документ — согласующим нечего будет смотреть. Приложите файл и запустите снова.",
      };

    const done = panel.filter((id) => spokeAlready(target, id));
    // Кто уже высказался, того не зовём заново: у роли своя история разговора,
    // и второе «посмотри материалы» выглядело бы для неё склерозом.
    const pending = panel.filter((id) => !spokeAlready(target, id));
    if (!pending.length)
      return { ok: false, note: "Весь состав уже посмотрел документ — прогонять заново нечего." };

    if (!runs.startPanelRun(data.windowId, { total: panel.length, doneRoleIds: done }))
      return { ok: false, note: "Состав уже идёт по документу — ответы появятся сами." };
    // Ключ занятости держим на весь прогон, а не на каждую роль отдельно:
    // иначе в паузу между двумя ролями успевал бы влезть вопрос от человека,
    // и два ответа легли бы в разговор друг на друга.
    q.startAsking(key);

    // Дальше — работа, которая переживёт этот запрос. Ошибку внутри ловим
    // сами: наверх её отдавать уже некому, а необработанный отказ обещания
    // роняет весь процесс, то есть чужие разговоры заодно.
    void (async () => {
      try {
        for (const roleId of pending) {
          // Разговор мог исчезнуть, пока прогон шёл: человек удалил его из
          // другой вкладки. Тогда остальным ролям идти уже некуда.
          const fresh = await d.readWindows(me.id);
          if (!fresh.some((w) => w.id === data.windowId)) break;

          runs.panelRoleStarted(data.windowId, roleId);
          try {
            const res = await askInWindow({
              me,
              windowId: data.windowId,
              text: textFor("open", ""),
              kind: "open",
              roleId,
            });
            runs.panelRoleFinished(data.windowId, roleId, res.ok);
            // Про недочитанные документы человеку скажет сам разговор при
            // следующем открытии; здесь эту приписку показывать негде, поэтому
            // оставляем её в журнале — иначе она пропадёт совсем.
            if (res.note) console.warn(`[состав] ${me.name} · ${roleId} · ${res.note}`);
          } catch (err) {
            // Одна роль сорвалась — остальные не виноваты. Записываем и идём
            // дальше: шесть разборов из семи лучше, чем ноль.
            runs.panelRoleFinished(data.windowId, roleId, false);
            console.error(
              `[состав] ${me.name} · роль ${roleId} сорвалась: ` +
                (err instanceof Error ? err.message.slice(0, 200) : "неизвестная ошибка"),
            );
          }
        }
      } finally {
        runs.finishPanelRun(data.windowId);
        q.doneAsking(key);
      }
    })();

    return {
      ok: true,
      note: `Состав пошёл по документу: ${pending.length} ${roleWord(pending.length)} впереди, каждая отвечает несколько минут. Страницу можно закрыть — ответы сохранятся.`,
    };
  });

/** Как идёт прогон. Клиент спрашивает это раз в несколько секунд, пока идёт. */
export type PanelState = {
  running: boolean;
  total: number;
  doneRoleIds: string[];
  currentRoleId: string | null;
  failedRoleIds: string[];
};

export const panelStateServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; windowId: string }) => data)
  .handler(async ({ data }): Promise<PanelState> => {
    const idle: PanelState = {
      running: false,
      total: 0,
      doneRoleIds: [],
      currentRoleId: null,
      failedRoleIds: [],
    };
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return idle;

    // Разговоры читаем всегда, даже когда прогон идёт: это заодно проверка,
    // что разговор принадлежит спрашивающему. Файл маленький, опрос редкий.
    const windows = await d.readWindows(me.id);
    const target = windows.find((w) => w.id === data.windowId);
    if (!target) return idle;

    const runs = await import("./server-runs");
    const run = runs.panelRunOf(data.windowId);
    if (run) {
      return {
        running: true,
        total: run.total,
        doneRoleIds: run.doneRoleIds,
        currentRoleId: run.currentRoleId,
        failedRoleIds: run.failedRoleIds,
      };
    }

    // Живого прогона нет. Считаем прошедших по самим репликам — так же честно
    // отвечаем и после перезапуска сервиса: память процесса прогон теряет, а
    // разборы ролей лежат на диске и никуда не делись. Человек увидит, что
    // прошли, скажем, четверо из семи, и допрогонит остальных.
    const panel = target.panel ?? [];
    return {
      running: false,
      total: panel.length,
      doneRoleIds: panel.filter((id) => spokeAlready(target, id)),
      currentRoleId: null,
      failedRoleIds: [],
    };
  });

/**
 * Разговоры, по которым прямо сейчас идёт работа.
 *
 * Человек, вернувшийся в кабинет с другой вкладки или с телефона, не видел,
 * что ответ ещё пишется: «думаю» жило только в той вкладке, где нажали
 * «Отправить». Разговор выглядел брошенным, и вопрос задавали заново.
 */
export const workingServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }): Promise<{ windowIds: string[] }> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { windowIds: [] as string[] };

    const q = await import("./server-queue");
    const runs = await import("./server-runs");
    // Отвечаем только про свои разговоры: занятость чужих — не наше дело.
    // Прогон держит тот же ключ занятости, что и одиночный вопрос, так что
    // хватило бы одной проверки; вторая стоит здесь на случай, если ключ
    // когда-нибудь отпустят раньше конца прогона.
    const windows = await d.readWindows(me.id);
    return {
      windowIds: windows
        .filter((w) => q.isAsking(askKey(me.id, w.id)) || runs.isPanelRunning(w.id))
        .map((w) => w.id),
    };
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
 * Перенести разговор в другую задачу.
 *
 * Работа редко раскладывается по папкам с первого раза: человек заводит задачу
 * второпях, говорит с агентом, а через неделю понимает, что разговор относился
 * к соседней. Раньше поправить это было нечем — разговор рождался в задаче и
 * оставался в ней навсегда, оставалось только начинать заново.
 *
 * Документы разговора переезжают вместе с ним, а документы задачи остаются на
 * месте: они принадлежат папке, а не переписке. Значит после переезда агент
 * при следующем вопросе увидит материалы НОВОЙ задачи — это и есть смысл
 * переноса, но человеку об этом стоит сказать, и интерфейс говорит.
 */
export const moveWindowServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; windowId: string; projectId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; windows: StoredWindow[]; note: string }> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) {
      return { ok: false, windows: [], note: "Кабинет вас не узнал — войдите по коду ещё раз." };
    }

    const { projects, windows } = await d.readWorkspace(me.id);
    const target = projects.find((p) => p.id === data.projectId);
    if (!target) return { ok: false, windows, note: "Задача не найдена — обновите страницу." };

    const moving = windows.find((w) => w.id === data.windowId);
    if (!moving) return { ok: false, windows, note: "Разговор не найден — обновите страницу." };
    if (moving.projectId === data.projectId) return { ok: true, windows, note: "" };

    const next = windows.map((w) =>
      w.id === data.windowId ? { ...w, projectId: data.projectId, updatedAt: stamp() } : w,
    );
    await d.writeWindows(me.id, next);
    return { ok: true, windows: next, note: "" };
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
    // Папки отдаём вместе с окнами: документы задачи лежат в папке, и без неё
    // администратор видел бы переписку без половины материалов.
    if (!me || me.role !== "admin")
      return { windows: [] as StoredWindow[], projects: [] as StoredProject[] };
    return d.readWorkspace(data.personId);
  });
