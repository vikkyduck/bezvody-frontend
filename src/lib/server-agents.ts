/**
 * Настройка агентов и вызов модели.
 *
 * У каждого агента свой системный промпт — его вписывает администратор
 * в своей панели. Ключ модели хранится на сервере отдельным файлом и
 * НИКОГДА не возвращается в браузер: наружу отдаётся только «задан или нет»
 * и последние четыре знака, чтобы можно было убедиться, что ключ тот самый.
 *
 * Наружу к модели ходим через транзит на DO-дроплете (ANTHROPIC_BASE_URL):
 * с РФ-адреса api.anthropic.com отвечает 403.
 */
import { createServerFn } from "@tanstack/react-start";

/** Чем работает агент: моделью напрямую или готовым сервисом по HTTP. */
export type Transport = "model" | "http";

export type AgentConfig = {
  /** Системный промпт: кто агент и как работает */
  prompt: string;
  /** Правило завершения — дописывается к инструкции последним абзацем */
  finishRule: string;
  model: string;
  /** Пока не настроен, агент честно говорит об этом клиенту */
  enabled: boolean;
  updatedAt: string | null;
  transport: Transport;
  /** Адрес вашего сервиса — когда transport = http */
  endpoint: string;
  /** Имя заголовка авторизации, обычно Authorization */
  authHeader: string;
  format: "openai" | "simple";
  /** Задан ли секрет доступа. Само значение наружу не отдаётся никогда */
  authSet: boolean;
};

export type AgentConfigMap = Record<string, AgentConfig>;

/** Что видит администратор: настройки агентов плюс признак ключа. */
export type AgentSettings = {
  agents: AgentConfigMap;
  keySet: boolean;
  keyTail: string;
};

export const MODELS = [
  { id: "claude-opus-5", label: "Opus 5 — самый сильный" },
  { id: "claude-sonnet-5", label: "Sonnet 5 — быстрее и дешевле" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5 — для простых задач" },
];

export const DEFAULT_MODEL = "claude-opus-5";

/**
 * Правило завершения работы. Дописывается к инструкции каждого агента.
 *
 * Оно решает одну конкретную беду: агент доходил до рекомендаций и
 * останавливался — уточнял, спрашивал разрешения, предлагал «собрать, если
 * нужно». Человек оставался с перепиской вместо документа. Команде нужен
 * документ, даже неполный: неполный можно дополнить, отсутствующий — нельзя.
 *
 * При этом разбор фактуры не выбрасывается, а становится второй частью
 * ответа: собранный документ — согласующим, разбор с вопросами — автору.
 * Обе части сохраняются в окне и обе уезжают в файл Word.
 *
 * Лежит отдельным полем, а не внутри инструкции: инструкцию пишет методолог
 * под задачу, а это — общее правило платформы, и видно, что оно включено.
 */
export const DEFAULT_FINISH_RULE = `Ответ всегда состоит из двух частей. Обе обязательны, даже если данных мало.

# Документ

Собранный документ по стандарту. Заполняй из того, что есть.
— не спрашивай разрешения собрать документ, собирай;
— недостающие графы оставляй в структуре и помечай «[данных нет]» — раздел не пропускай;
— каждое утверждение, взятое из присланных материалов, помечай источником;
— где вывод держится на догадке, пиши «предположение» рядом с ним.
Это та часть, которую человек понесёт согласующим: в ней нет твоих обращений к автору.

# Разбор и вопросы

Здесь ты говоришь с автором, а не с согласующими.
— что в фактуре сильное, а что слабое: где выводы висят на предположениях;
— какие графы остались пустыми и чем именно их закрыть — где взять цифру, у кого спросить;
— какой вывод документа изменится, если данные окажутся другими;
— уточняющие вопросы списком, самые важные первыми.
Не предлагай «собрать документ позже» — он уже собран выше. Предлагай, чем закрыть пустые графы.

Заголовки двух частей пиши ровно так: «# Документ» и «# Разбор и вопросы». По ним платформа собирает файл Word: документ идёт основной частью, разбор — отдельным приложением с новой страницы.`;

export const emptyConfig = (): AgentConfig => ({
  prompt: "",
  finishRule: DEFAULT_FINISH_RULE,
  model: DEFAULT_MODEL,
  enabled: false,
  updatedAt: null,
  transport: "model",
  endpoint: "",
  authHeader: "Authorization",
  format: "openai",
  authSet: false,
});

/** Старая запись могла быть без новых полей — добиваем значениями по умолчанию. */
export function normalizeConfig(c: Partial<AgentConfig> | undefined): AgentConfig {
  const base = { ...emptyConfig(), ...(c ?? {}) };
  // Запись, сделанная до появления правила, получает его по умолчанию:
  // включать руками каждому агенту — лишний повод забыть.
  return {
    ...base,
    finishRule: c && "finishRule" in c ? (c.finishRule ?? "") : DEFAULT_FINISH_RULE,
    authSet: Boolean(base.authSet),
  };
}

/** Что уедет модели: инструкция агента плюс правило завершения. */
export function systemPromptOf(cfg: Partial<AgentConfig> | undefined): string {
  const c = normalizeConfig(cfg);
  const rule = c.finishRule.trim();
  const prompt = c.prompt.trim();
  if (!prompt) return "";
  return rule ? `${prompt}\n\n---\n\n${rule}` : prompt;
}

// ── Чтение и запись ───────────────────────────────────────────────────────────

export const getAgentSettingsServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }): Promise<AgentSettings> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me || me.role !== "admin") return { agents: {}, keySet: false, keyTail: "" };

    const agents = await withAuthFlags(d, await d.readJson<AgentConfigMap>(`${d.dataDir()}/agents.json`, {}));
    const key = await d.readApiKey();
    return { agents, keySet: Boolean(key), keyTail: key ? key.slice(-4) : "" };
  });

/** Проставляем «секрет задан», не раскрывая сам секрет. */
async function withAuthFlags(
  d: typeof import("./server-data"),
  agents: AgentConfigMap,
): Promise<AgentConfigMap> {
  const out: AgentConfigMap = {};
  for (const [id, cfg] of Object.entries(agents)) {
    out[id] = { ...normalizeConfig(cfg), authSet: Boolean(await d.readAgentAuth(id)) };
  }
  return out;
}

export const saveAgentServer = createServerFn({ method: "POST" })
  .validator(
    (data: {
      code: string;
      agentId: string;
      prompt: string;
      finishRule?: string;
      model: string;
      transport?: Transport;
      endpoint?: string;
      authHeader?: string;
      format?: "openai" | "simple";
      /** Пустая строка — не трогать; значение — заменить; "-" — стереть */
      auth?: string;
    }) => data,
  )
  .handler(async ({ data }): Promise<AgentSettings> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me || me.role !== "admin") return { agents: {}, keySet: false, keyTail: "" };

    const file = `${d.dataDir()}/agents.json`;
    const agents = await d.readJson<AgentConfigMap>(file, {});
    const prev = normalizeConfig(agents[data.agentId]);
    const prompt = String(data.prompt ?? "").trim();
    const transport = data.transport ?? prev.transport;
    const endpoint = (data.endpoint ?? prev.endpoint).trim();

    if (data.auth === "-") await d.writeAgentAuth(data.agentId, "");
    else if (data.auth) await d.writeAgentAuth(data.agentId, data.auth.trim());

    agents[data.agentId] = {
      ...prev,
      prompt,
      finishRule: data.finishRule ?? prev.finishRule,
      model: MODELS.some((m) => m.id === data.model) ? data.model : DEFAULT_MODEL,
      transport,
      endpoint,
      authHeader: (data.authHeader ?? prev.authHeader).trim() || "Authorization",
      format: data.format ?? prev.format,
      // Модели нужен промпт, чужому сервису — адрес. Без этого включать нечего.
      enabled: transport === "model" ? prompt.length > 0 : endpoint.length > 0,
      updatedAt: new Date().toISOString(),
    };
    await d.writeJson(file, agents);

    const key = await d.readApiKey();
    return { agents: await withAuthFlags(d, agents), keySet: Boolean(key), keyTail: key ? key.slice(-4) : "" };
  });

export const saveApiKeyServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; key: string }) => data)
  .handler(async ({ data }): Promise<AgentSettings> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me || me.role !== "admin") return { agents: {}, keySet: false, keyTail: "" };

    await d.writeApiKey(String(data.key ?? "").trim());
    const agents = await d.readJson<AgentConfigMap>(`${d.dataDir()}/agents.json`, {});
    const key = await d.readApiKey();
    return { agents, keySet: Boolean(key), keyTail: key ? key.slice(-4) : "" };
  });

/**
 * Проверка связи: шлём в сервис короткий вопрос и возвращаем, что пришло.
 * Сырой ответ нужен, чтобы за один заход увидеть форму чужого API,
 * а не гадать по документации, которой может не быть.
 */
export const testAgentServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; agentId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; detail: string; raw: string; text: string }> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me || me.role !== "admin") return { ok: false, detail: "нет доступа", raw: "", text: "" };

    const agents = await d.readJson<AgentConfigMap>(`${d.dataDir()}/agents.json`, {});
    const cfg = normalizeConfig(agents[data.agentId]);
    if (cfg.transport !== "http") return { ok: false, detail: "агент работает напрямую через модель", raw: "", text: "" };

    const { callHttpAgent } = await import("./server-http-agent");
    const res = await callHttpAgent({
      settings: { endpoint: cfg.endpoint, authHeader: cfg.authHeader, format: cfg.format, model: cfg.model },
      auth: await d.readAgentAuth(data.agentId),
      systemPrompt: systemPromptOf(cfg),
      history: [],
      question: "Проверка связи. Ответь одним предложением, что ты за агент.",
      timeoutMs: 60_000,
    });

    return res.ok
      ? { ok: true, detail: "связь есть", raw: res.raw, text: res.text }
      : { ok: false, detail: res.detail, raw: res.raw, text: "" };
  });
