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

export const emptyConfig = (): AgentConfig => ({
  prompt: "",
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
  return { ...base, authSet: Boolean(base.authSet) };
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
      systemPrompt: cfg.prompt,
      history: [],
      question: "Проверка связи. Ответь одним предложением, что ты за агент.",
      timeoutMs: 60_000,
    });

    return res.ok
      ? { ok: true, detail: "связь есть", raw: res.raw, text: res.text }
      : { ok: false, detail: res.detail, raw: res.raw, text: "" };
  });
