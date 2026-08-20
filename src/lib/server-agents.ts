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

export type AgentConfig = {
  /** Системный промпт: кто агент и как работает */
  prompt: string;
  model: string;
  /** Пока промпта нет, агент честно говорит, что не настроен */
  enabled: boolean;
  updatedAt: string | null;
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
});

// ── Чтение и запись ───────────────────────────────────────────────────────────

export const getAgentSettingsServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }): Promise<AgentSettings> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me || me.role !== "admin") return { agents: {}, keySet: false, keyTail: "" };

    const agents = await d.readJson<AgentConfigMap>(`${d.dataDir()}/agents.json`, {});
    const key = await d.readApiKey();
    return { agents, keySet: Boolean(key), keyTail: key ? key.slice(-4) : "" };
  });

export const saveAgentServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; agentId: string; prompt: string; model: string }) => data)
  .handler(async ({ data }): Promise<AgentSettings> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me || me.role !== "admin") return { agents: {}, keySet: false, keyTail: "" };

    const file = `${d.dataDir()}/agents.json`;
    const agents = await d.readJson<AgentConfigMap>(file, {});
    const prompt = String(data.prompt ?? "").trim();
    agents[data.agentId] = {
      prompt,
      model: MODELS.some((m) => m.id === data.model) ? data.model : DEFAULT_MODEL,
      // Без промпта агента включать нечего: он не знает, что делать.
      enabled: prompt.length > 0,
      updatedAt: new Date().toISOString(),
    };
    await d.writeJson(file, agents);

    const key = await d.readApiKey();
    return { agents, keySet: Boolean(key), keyTail: key ? key.slice(-4) : "" };
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
