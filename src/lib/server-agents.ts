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

import { DEFAULT_ROLES, ROLE_RULES, type AgentRole } from "./roles";
import { DEFAULT_MODEL_OF, PROVIDERS, isProvider, type Provider } from "./providers";

/** Чем работает агент: моделью напрямую или готовым сервисом по HTTP. */
export type Transport = "model" | "http";

export type AgentConfig = {
  /** Системный промпт: кто агент и как работает */
  prompt: string;
  /** Чем думает агент: Claude, GPT или Gemini. Ключ у каждого свой */
  provider: Provider;
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
  /**
   * Роли, от лица которых говорит агент. Есть не у всех: обычный агент —
   * один собеседник. Не задано — берутся роли по умолчанию из кода
   * (см. rolesOf); пустой список означает «ролей нет», и это разные вещи.
   */
  roles?: AgentRole[];
};

export type AgentConfigMap = Record<string, AgentConfig>;

/** Задан ли ключ провайдера. Сам ключ наружу не отдаётся никогда. */
export type KeyState = { set: boolean; tail: string };

/** Что видит администратор: настройки агентов плюс признаки ключей. */
export type AgentSettings = {
  agents: AgentConfigMap;
  keys: Record<Provider, KeyState>;
  /**
   * Роли по умолчанию — чтобы админка могла показать «вернуть как было».
   * Приезжают ответом сервера, а не импортом из кода: иначе инструкции ролей
   * попадают в бандл браузера, а это методология, за которую платит заказчик.
   */
  defaultRoles: Record<string, AgentRole[]>;
};

export const emptyKeys = (): Record<Provider, KeyState> => ({
  anthropic: { set: false, tail: "" },
  openai: { set: false, tail: "" },
  gemini: { set: false, tail: "" },
});

const emptySettings = (): AgentSettings => ({ agents: {}, keys: emptyKeys(), defaultRoles: {} });

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
  provider: "anthropic",
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
    // Записи, сделанные до появления выбора модели, работали на Claude.
    provider: isProvider(base.provider) ? base.provider : "anthropic",
    authSet: Boolean(base.authSet),
  };
}

/** Что уедет модели: инструкция агента плюс правило завершения. */
export function systemPromptOf(cfg: Partial<AgentConfig> | undefined, role?: AgentRole | null): string {
  const c = normalizeConfig(cfg);
  const prompt = c.prompt.trim();

  // Разговор от лица роли. Инструкция роли самодостаточна — она работает и
  // тогда, когда общей инструкции агенту не задали. Правило завершения обычных
  // агентов сюда не идёт: там на выходе документ, здесь — живой разговор,
  // и требовать «# Документ» от собеседника бессмысленно.
  if (role) {
    return [prompt, role.prompt.trim(), ROLE_RULES.trim()].filter(Boolean).join("\n\n---\n\n");
  }

  const rule = c.finishRule.trim();
  if (!prompt) return "";
  return rule ? `${prompt}\n\n---\n\n${rule}` : prompt;
}

/**
 * Роли агента: что настроил методолог, а пока не настроил — что лежит в коде.
 *
 * Разница между «не задано» и «пустой список» существенна: undefined значит
 * «роли по умолчанию», [] — «методолог убрал роли осознанно».
 */
export function rolesOf(agentId: string, cfg?: Partial<AgentConfig> | null): AgentRole[] {
  if (cfg && Array.isArray(cfg.roles)) return cfg.roles;
  return DEFAULT_ROLES[agentId] ?? [];
}

export const roleById = (roles: AgentRole[], id: string | null | undefined) =>
  roles.find((r) => r.id === id) ?? null;

// ── Чтение и запись ───────────────────────────────────────────────────────────

export const getAgentSettingsServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }): Promise<AgentSettings> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me || me.role !== "admin") return emptySettings();

    const agents = await withAuthFlags(d, await d.readJson<AgentConfigMap>(`${d.dataDir()}/agents.json`, {}));
    return { agents, keys: await keysSummary(d), defaultRoles: DEFAULT_ROLES };
  });

/** По каждому провайдеру: задан ли ключ и его хвост — сверить, тот ли это ключ. */
async function keysSummary(d: typeof import("./server-data")): Promise<Record<Provider, KeyState>> {
  const out = emptyKeys();
  for (const { id } of PROVIDERS) {
    const key = await d.readApiKey(id);
    out[id] = { set: Boolean(key), tail: key ? key.slice(-4) : "" };
  }
  return out;
}

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
      provider?: Provider;
      model: string;
      transport?: Transport;
      endpoint?: string;
      authHeader?: string;
      format?: "openai" | "simple";
      /** Роли агента целиком: undefined — не трогать */
      roles?: AgentRole[];
      /** Пустая строка — не трогать; значение — заменить; "-" — стереть */
      auth?: string;
    }) => data,
  )
  .handler(async ({ data }): Promise<AgentSettings> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me || me.role !== "admin") return emptySettings();

    const file = `${d.dataDir()}/agents.json`;
    const agents = await d.readJson<AgentConfigMap>(file, {});
    const prev = normalizeConfig(agents[data.agentId]);
    const prompt = String(data.prompt ?? "").trim();
    const transport = data.transport ?? prev.transport;
    const provider: Provider = isProvider(data.provider) ? data.provider : prev.provider;
    const endpoint = (data.endpoint ?? prev.endpoint).trim();

    if (data.auth === "-") await d.writeAgentAuth(data.agentId, "");
    else if (data.auth) await d.writeAgentAuth(data.agentId, data.auth.trim());

    // Роли приходят списком целиком: правка одной роли — это новый список.
    const roles = Array.isArray(data.roles) ? data.roles.map(cleanRole).filter((r) => r.name && r.prompt) : prev.roles;

    agents[data.agentId] = {
      ...prev,
      prompt,
      provider,
      ...(roles ? { roles } : {}),
      finishRule: data.finishRule ?? prev.finishRule,
      // У Claude модель выбирается из нашего списка, у чужих провайдеров имя
      // вписывается руками: их линейки меняются чаще, чем мы правим код.
      model:
        provider === "anthropic"
          ? MODELS.some((m) => m.id === data.model)
            ? data.model
            : DEFAULT_MODEL
          : String(data.model ?? "").trim().slice(0, 100) || DEFAULT_MODEL_OF[provider],
      transport,
      endpoint,
      authHeader: (data.authHeader ?? prev.authHeader).trim() || "Authorization",
      format: data.format ?? prev.format,
      // Модели нужен промпт, чужому сервису — адрес. Без этого включать нечего.
      // У агента с ролями инструкция может быть пустой: говорят роли, и каждая
      // инструкция роли самодостаточна.
      enabled:
        transport === "model"
          ? prompt.length > 0 || (roles ?? rolesOf(data.agentId, prev)).length > 0
          : endpoint.length > 0,
      updatedAt: new Date().toISOString(),
    };
    await d.writeJson(file, agents);

    return { agents: await withAuthFlags(d, agents), keys: await keysSummary(d), defaultRoles: DEFAULT_ROLES };
  });

export const saveApiKeyServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; key: string; provider?: Provider }) => data)
  .handler(async ({ data }): Promise<AgentSettings> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me || me.role !== "admin") return emptySettings();

    const provider: Provider = isProvider(data.provider) ? data.provider : "anthropic";
    await d.writeApiKey(provider, String(data.key ?? "").trim());
    const agents = await d.readJson<AgentConfigMap>(`${d.dataDir()}/agents.json`, {});
    return { agents, keys: await keysSummary(d), defaultRoles: DEFAULT_ROLES };
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

    // Агент на модели: проверяем, что ключ и имя модели рабочие. Это главный
    // способ узнать правду про чужого провайдера — их линейки меняются, и
    // ответ на живой запрос честнее любого списка в коде.
    if (cfg.transport === "model") {
      const { askAgent } = await import("./server-llm");
      const res = await askAgent({
        systemPrompt: "Отвечай кратко и по-русски.",
        model: cfg.model,
        provider: cfg.provider,
        history: [],
        question: "Проверка связи. Ответь одним предложением: какая ты модель.",
        label: `${data.agentId} · проверка связи`,
      });
      return res.ok
        ? { ok: true, detail: `связь есть · ${cfg.provider} · ${cfg.model}`, raw: "", text: res.text }
        : {
            ok: false,
            detail:
              res.reason === "no-key"
                ? `ключ ${res.detail ?? cfg.provider} не задан`
                : res.reason === "busy"
                  ? "провайдер отвечает «занято» — попробуйте через минуту"
                  : (res.detail ?? "связи нет"),
            raw: "",
            text: "",
          };
    }

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

/** Роль из админки: обрезаем и не даём завести роль без имени или без инструкции. */
function cleanRole(r: AgentRole): AgentRole {
  return {
    id: String(r.id ?? "").trim() || `role-${Math.random().toString(36).slice(2, 8)}`,
    name: String(r.name ?? "").trim().slice(0, 120),
    hint: String(r.hint ?? "").trim().slice(0, 200),
    group: String(r.group ?? "").trim().slice(0, 120),
    prompt: String(r.prompt ?? "").trim(),
  };
}

/**
 * Роли агента для клиента — только имена и подписи, без инструкций.
 *
 * Инструкция роли — это методология, за которую заплатил заказчик; в браузер
 * ей ехать незачем. Кнопке хватает имени, подписи и группы.
 */
export const getAgentRolesServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; agentId: string }) => data)
  .handler(async ({ data }): Promise<{ roles: Array<Omit<AgentRole, "prompt">> }> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { roles: [] };
    // Чужого агента не показываем даже списком ролей.
    if (me.role === "client" && !me.agentIds.includes(data.agentId)) return { roles: [] };

    const agents = await d.readJson<AgentConfigMap>(`${d.dataDir()}/agents.json`, {});
    const roles = rolesOf(data.agentId, agents[data.agentId]);
    return { roles: roles.map(({ id, name, hint, group }) => ({ id, name, hint, group })) };
  });
