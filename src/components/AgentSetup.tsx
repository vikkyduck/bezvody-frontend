import { useEffect, useState } from "react";

import {
  DEFAULT_MODEL_OF,
  MODEL_HINTS,
  PROVIDERS,
  providerLabel,
  type Provider,
} from "@/lib/providers";
import type { AgentPass } from "@/lib/passes";
import type { AgentRole } from "@/lib/roles";

import { Attachments } from "@/components/Attachments";
import { MAX_AGENT_FILES, type StoredFile } from "@/lib/documents";
import {
  deleteAgentFileServer,
  downloadFileServer,
  listAgentFilesServer,
  uploadAgentFileServer,
  type AgentFilesMap,
} from "@/lib/server-files";
import { useSession } from "@/lib/session";
import {
  DEFAULT_FINISH_RULE,
  DEFAULT_MODEL,
  MODELS,
  emptyKeys,
  getAgentSettingsServer,
  normalizeConfig,
  saveAgentServer,
  saveApiKeyServer,
  testAgentServer,
  type AgentSettings,
  type KeyState,
  type Transport,
} from "@/lib/server-agents";
import { agents } from "@/lib/shtab-data";

/**
 * Настройка агентов: инструкция для каждого, документы и один ключ модели.
 *
 * Ключ вводится один раз и обратно не показывается — только последние четыре
 * знака, чтобы убедиться, что он тот самый. Инструкция агента — обычный текст:
 * вставили из документа, сохранили, агент начал работать.
 *
 * Документы агента — то, что он должен знать всегда: методика, стандарт,
 * шаблон отчёта. Их видит каждый клиент этого агента, в отличие от материалов,
 * которые клиент приносит в своё окно.
 */
export function AgentSetup() {
  const { code } = useSession();
  const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [files, setFiles] = useState<AgentFilesMap>({});

  useEffect(() => {
    if (!code) return;
    getAgentSettingsServer({ data: { code } })
      .then(setSettings)
      .catch(() =>
        setSettings({ agents: {}, keys: emptyKeys(), defaultRoles: {}, defaultPasses: {} }),
      );
    listAgentFilesServer({ data: { code } })
      .then(setFiles)
      .catch(() => setFiles({}));
  }, [code]);

  if (!settings) return <p className="text-[13px] text-muted-foreground">Загружаю…</p>;

  return (
    <div className="space-y-10">
      <ApiKey settings={settings} onSaved={setSettings} />

      <section>
        <h2 className="mb-1 text-[15px] font-semibold">Инструкции агентов</h2>
        <div className="space-y-3">
          {agents.map((a) => (
            <AgentCard
              key={a.id}
              id={a.id}
              name={a.name}
              settings={settings}
              onSaved={setSettings}
              files={files[a.id] ?? []}
              onFiles={setFiles}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function ApiKey({
  settings,
  onSaved,
}: {
  settings: AgentSettings;
  onSaved: (s: AgentSettings) => void;
}) {
  return (
    <section className="card-flat px-5 py-5">
      <h2 className="text-[15px] font-semibold">Ключи моделей</h2>

      <div className="mt-4 space-y-3">
        {PROVIDERS.map((p) => (
          <ProviderKey
            key={p.id}
            provider={p.id}
            label={p.label}
            settings={settings}
            onSaved={onSaved}
          />
        ))}
      </div>
    </section>
  );
}

function ProviderKey({
  provider,
  label,
  settings,
  onSaved,
}: {
  provider: Provider;
  label: string;
  settings: AgentSettings;
  onSaved: (s: AgentSettings) => void;
}) {
  const { code } = useSession();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const state = settings.keys[provider] ?? { set: false, tail: "" };

  async function save() {
    if (!code || !value.trim()) return;
    setBusy(true);
    try {
      onSaved(await saveApiKeyServer({ data: { code, provider, key: value } }));
      setValue("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[12px] border border-[color:var(--color-line)] px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[13.5px] font-medium">{label}</span>
        <span className="text-[11.5px] text-muted-foreground">
          {state.set ? (
            <>
              ключ задан <span className="t-number tracking-[0.08em]">••••{state.tail}</span>
            </>
          ) : (
            "ключа нет"
          )}
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-end gap-2.5">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={state.set ? "впишите новый, чтобы заменить" : "вставьте ключ"}
          autoComplete="off"
          spellCheck={false}
          className="min-w-[240px] flex-1 rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3 py-2 text-[13px] outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40"
        />
        <button
          onClick={save}
          disabled={busy || !value.trim()}
          className="btn btn-glass text-[12.5px] disabled:opacity-40"
        >
          {busy ? "Сохраняю" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}

function AgentCard({
  id,
  name,
  settings,
  onSaved,
  files,
  onFiles,
}: {
  id: string;
  name: string;
  settings: AgentSettings;
  onSaved: (s: AgentSettings) => void;
  files: StoredFile[];
  onFiles: (m: AgentFilesMap) => void;
}) {
  const { code } = useSession();
  const saved = normalizeConfig(settings.agents[id]);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(saved.prompt);
  const [finishRule, setFinishRule] = useState(saved.finishRule);
  const [model, setModel] = useState(saved.model || DEFAULT_MODEL);
  const [transport, setTransport] = useState<Transport>(saved.transport);
  const [provider, setProvider] = useState<Provider>(saved.provider);
  const [endpoint, setEndpoint] = useState(saved.endpoint);
  const [authHeader, setAuthHeader] = useState(saved.authHeader);
  const [format, setFormat] = useState<"openai" | "simple">(saved.format);
  const [auth, setAuth] = useState("");
  // Та же логика, что на сервере: не задано — роли по умолчанию, пустой
  // список — «ролей нет» осознанно.
  const configuredRoles = settings.agents[id]?.roles;
  const savedRoles = Array.isArray(configuredRoles)
    ? configuredRoles
    : (settings.defaultRoles[id] ?? []);
  const [roles, setRoles] = useState<AgentRole[]>(savedRoles);

  // Прогоны сборки: та же логика, что у ролей — не задано означает «по
  // умолчанию из кода», пустой список означает «конвейера нет».
  const configuredPasses = settings.agents[id]?.passes;
  const savedPasses = Array.isArray(configuredPasses)
    ? configuredPasses
    : (settings.defaultPasses[id] ?? []);
  const [passes, setPasses] = useState<AgentPass[]>(savedPasses);
  const [mentorRule, setMentorRule] = useState(saved.mentorRule);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  /** Есть несохранённый черновик, отложенный браузером */
  const [draftAt, setDraftAt] = useState("");
  const [test, setTest] = useState<{
    ok: boolean;
    detail: string;
    raw: string;
    text: string;
  } | null>(null);

  // ── Черновик ───────────────────────────────────────────────────────────────
  /**
   * Пока карточка открыта, правки складываются в браузер. Инструкция агента —
   * это полчаса работы; оборванный запрос, случайная перезагрузка или
   * закрытая вкладка не должны стирать её. Черновик исчезает, как только
   * сохранение прошло.
   */
  const draftKey = `bv-agent-draft-${id}`;

  const dropDraft = () => {
    setDraftAt("");
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* приватный режим браузера — работаем без черновика */
    }
  };

  useEffect(() => {
    if (!open) return;
    // Пока черновик ждёт решения человека, не трогаем его: иначе открытая
    // карточка сама стирает его через секунду — возвращать будет нечего.
    if (draftAt) return;
    const timer = setTimeout(() => {
      try {
        const same =
          prompt === saved.prompt &&
          finishRule === saved.finishRule &&
          JSON.stringify(roles) === JSON.stringify(savedRoles);
        if (same) {
          localStorage.removeItem(draftKey);
          return;
        }
        localStorage.setItem(
          draftKey,
          JSON.stringify({ at: new Date().toISOString(), prompt, finishRule, roles }),
        );
      } catch {
        /* см. выше */
      }
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftAt, prompt, finishRule, JSON.stringify(roles)]);

  // Открыли карточку — проверяем, не осталось ли неспасённой работы.
  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw) as {
        at: string;
        prompt: string;
        finishRule: string;
        roles: AgentRole[];
      };
      const same =
        d.prompt === saved.prompt && JSON.stringify(d.roles ?? []) === JSON.stringify(savedRoles);
      if (same) {
        localStorage.removeItem(draftKey);
        return;
      }
      setDraftAt(
        new Date(d.at).toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    } catch {
      /* см. выше */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function restoreDraft() {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw) as { prompt: string; finishRule: string; roles: AgentRole[] };
      setPrompt(d.prompt ?? "");
      setFinishRule(d.finishRule ?? "");
      if (Array.isArray(d.roles)) setRoles(d.roles);
      setDraftAt("");
    } catch {
      /* см. выше */
    }
  }

  // Сохранили из другого места — подхватываем, пока карточка свёрнута.
  useEffect(() => {
    if (open) return;
    setPrompt(saved.prompt);
    setFinishRule(saved.finishRule);
    setModel(saved.model || DEFAULT_MODEL);
    setTransport(saved.transport);
    setProvider(saved.provider);
    setEndpoint(saved.endpoint);
    setAuthHeader(saved.authHeader);
    setFormat(saved.format);
    setRoles(savedRoles);
    setPasses(savedPasses);
    setMentorRule(saved.mentorRule);
    // savedRoles — новый массив на каждый рендер, поэтому в зависимостях он
    // строкой: иначе эффект переустанавливал бы состояние без конца.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    saved.prompt,
    saved.finishRule,
    saved.model,
    saved.transport,
    saved.provider,
    saved.endpoint,
    saved.authHeader,
    saved.format,
    JSON.stringify(savedRoles),
    JSON.stringify(savedPasses),
    saved.mentorRule,
  ]);

  /**
   * Сохранение с потолком ожидания и внятным исходом.
   *
   * Раньше сорвавшийся запрос оставлял кнопку в «Сохраняю» навсегда: ни
   * ошибки, ни подтверждения. Человек уходил со страницы, считая, что
   * сохранилось, и терял работу. Теперь ждём не дольше полутора минут и в
   * любом исходе говорим словами, что произошло; текст при этом остаётся
   * в поле и в черновике.
   */
  async function save() {
    if (!code) return;
    setBusy(true);
    setDone("");
    setError("");
    setTest(null);

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("долго")), 90_000),
    );

    try {
      const next = await Promise.race([
        saveAgentServer({
          data: {
            code,
            agentId: id,
            prompt,
            finishRule,
            mentorRule,
            passes,
            provider,
            model,
            transport,
            endpoint,
            authHeader,
            format,
            auth,
            roles,
          },
        }),
        timeout,
      ]);

      onSaved(next);
      setAuth("");
      dropDraft();

      // Сверяем, что вернулось: сервер не записывает роль без имени или без
      // инструкции — про это надо сказать, а не терять её молча.
      const back = next.agents[id];
      const lostRoles =
        roles.filter((r) => r.name.trim() && r.prompt.trim()).length - (back?.roles?.length ?? 0);
      const badRoles = roles.filter((r) => !r.name.trim() || !r.prompt.trim()).length;

      const at = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      if (badRoles) {
        setError(
          `Сохранено в ${at}, но ${badRoles === 1 ? "одна роль не записана" : `${badRoles} рол(и) не записаны`}: ` +
            "у роли обязательны имя и инструкция",
        );
      } else if (lostRoles > 0) {
        setError(`Сохранено в ${at}, но ролей записалось меньше, чем отправлено`);
      } else {
        setDone(`Сохранено в ${at}`);
      }
    } catch (err) {
      const long = err instanceof Error && err.message === "долго";
      setError(
        long ? "Сервер не ответил за полторы минуты" : "Не удалось сохранить: связь оборвалась",
      );
    } finally {
      setBusy(false);
    }
  }

  async function checkLink() {
    if (!code) return;
    setBusy(true);
    setTest(null);
    try {
      setTest(await testAgentServer({ data: { code, agentId: id } }));
    } finally {
      setBusy(false);
    }
  }

  const where =
    saved.transport === "http"
      ? "ваш сервис"
      : saved.provider === "anthropic"
        ? (MODELS.find((m) => m.id === saved.model)?.label ?? saved.model)
        : `${providerLabel(saved.provider)} · ${saved.model}`;

  return (
    <div className="card-flat px-5 py-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span className="text-[15px] font-semibold">{name}</span>
            <span
              className={`rounded-[var(--radius-pill)] border px-2 py-[2px] text-[10px] uppercase tracking-[0.12em] ${
                saved.enabled || savedRoles.length
                  ? "border-[color:var(--color-accent)] text-[color:var(--color-accent)]"
                  : "border-[color:var(--color-line)] text-muted-foreground"
              }`}
            >
              {saved.enabled || savedRoles.length ? "настроен" : "не настроен"}
            </span>
          </div>
          {saved.enabled || savedRoles.length ? (
            <p className="mt-1 text-[12px] text-muted-foreground">
              {saved.transport === "http"
                ? `${where} · ${saved.endpoint}`
                : saved.prompt.length
                  ? `${where} · инструкция ${saved.prompt.length} знаков`
                  : where}
              {savedRoles.length ? ` · ролей ${savedRoles.length}` : ""}
              {files.length ? ` · документов ${files.length}` : ""}
            </p>
          ) : null}
        </div>
        <button onClick={() => setOpen((v) => !v)} className="btn btn-glass text-[12.5px]">
          {open ? "Свернуть" : "Настроить"}
        </button>
      </div>

      {/* Провайдер выбран, а ключа к нему нет — агент промолчит, и понять это
          по карточке было нельзя: ключи живут в другом разделе. */}
      {saved.transport === "model" && !settings.keys[saved.provider]?.set ? (
        <p className="mt-2 text-[12px] text-[color:var(--color-error)]">
          Ключ {providerLabel(saved.provider)} не задан — в разговоре агент отвечать не сможет.
          Впишите его выше, в «Ключах моделей».
        </p>
      ) : null}

      {open ? (
        <div className="mt-5 space-y-4 border-t border-[color:var(--color-line)] pt-5">
          {/* Незаписанная работа с прошлого захода: сорвался запрос, закрылась вкладка */}
          {draftAt ? (
            <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-[color:var(--color-accent)] px-4 py-2.5">
              <span className="flex-1 text-[12.5px]">
                Остался несохранённый черновик от {draftAt}
              </span>
              <button onClick={restoreDraft} className="btn btn-glass text-[12px]">
                Вернуть в поля
              </button>
              <button onClick={dropDraft} className="btn btn-ghost text-[12px]">
                Выбросить
              </button>
            </div>
          ) : null}

          <div>
            <span className="label-caps">Кто отвечает</span>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={() => setTransport("model")}
                className={`btn text-[12px] ${transport === "model" ? "btn-primary" : "btn-glass"}`}
              >
                Модель напрямую
              </button>
              <button
                onClick={() => setTransport("http")}
                className={`btn text-[12px] ${transport === "http" ? "btn-primary" : "btn-glass"}`}
              >
                Ваш готовый сервис
              </button>
            </div>
          </div>

          {transport === "model" ? (
            <div>
              <span className="label-caps">Чем думает агент</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {PROVIDERS.map((pr) => (
                  <button
                    key={pr.id}
                    onClick={() => {
                      setProvider(pr.id);
                      // Имя модели принадлежит провайдеру: claude-opus-5 в GPT
                      // не существует, и оставлять его — готовая ошибка.
                      setModel(DEFAULT_MODEL_OF[pr.id]);
                      setDone("");
                    }}
                    className={`btn text-[12px] ${provider === pr.id ? "btn-primary" : "btn-glass"}`}
                  >
                    {pr.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {transport === "http" ? (
            <div className="space-y-3">
              <label className="block">
                <span className="label-caps">Адрес сервиса</span>
                <input
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://ваш-сервис.ру/api/agent"
                  spellCheck={false}
                  className={inputCls}
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="label-caps">Ключ или токен доступа</span>
                  <input
                    type="password"
                    value={auth}
                    onChange={(e) => setAuth(e.target.value)}
                    placeholder={
                      saved.authSet
                        ? "задан — впишите новый, чтобы заменить"
                        : "если сервис требует"
                    }
                    autoComplete="off"
                    spellCheck={false}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="label-caps">Заголовок авторизации</span>
                  <input
                    value={authHeader}
                    onChange={(e) => setAuthHeader(e.target.value)}
                    placeholder="Authorization"
                    spellCheck={false}
                    className={inputCls}
                  />
                </label>
              </div>

              <label className="block">
                <span className="label-caps">Формат запроса</span>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as "openai" | "simple")}
                  className={inputCls}
                >
                  <option value="openai">
                    Как у OpenAI — messages[], ответ в choices[0].message.content
                  </option>
                  <option value="simple">
                    Простой — шлём message + history, ответ ищем в reply / text / answer
                  </option>
                </select>
              </label>
            </div>
          ) : null}

          <label className="block">
            <span className="label-caps">Инструкция агента</span>
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setDone("");
              }}
              rows={transport === "http" ? 6 : 16}
              placeholder="Вставьте сюда текст инструкции: кто агент, что делает, в каком виде отдаёт результат"
              className="mt-1.5 w-full resize-y rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3.5 py-3 text-[13px] leading-relaxed outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40"
            />
          </label>

          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="label-caps">Чем заканчивать работу</span>
              {finishRule.trim() !== DEFAULT_FINISH_RULE.trim() ? (
                <button
                  onClick={() => setFinishRule(DEFAULT_FINISH_RULE)}
                  className="text-[11.5px] text-muted-foreground underline underline-offset-4"
                >
                  вернуть правило платформы
                </button>
              ) : null}
            </div>
            <textarea
              value={finishRule}
              onChange={(e) => {
                setFinishRule(e.target.value);
                setDone("");
              }}
              rows={7}
              placeholder="Пусто — агент заканчивает работу так, как решит сам"
              className="mt-2 w-full resize-y rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3.5 py-3 text-[12.5px] leading-relaxed outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40"
            />
          </div>

          {transport === "model" && savedPasses.length ? (
            <div className="border-t border-[color:var(--color-line)] pt-4">
              <span className="label-caps">Разговор: как ведёт разбор</span>
              <p className="measure mt-1 mb-2 text-[12.5px] text-muted-foreground">
                У агента с конвейером разговор — это разбор, а не сборка: он доводит фактуру, а
                документ собирается кнопкой. Это правило заменяет «чем заканчивать работу».
              </p>
              <textarea
                value={mentorRule}
                onChange={(e) => {
                  setMentorRule(e.target.value);
                  setDone("");
                }}
                rows={8}
                className="w-full resize-y rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3.5 py-3 text-[12.5px] leading-relaxed outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40"
              />
            </div>
          ) : null}

          {transport === "model" && savedPasses.length ? (
            <Passes
              defaults={settings.defaultPasses[id] ?? []}
              passes={passes}
              keys={settings.keys}
              onChange={(next) => {
                setPasses(next);
                setDone("");
              }}
            />
          ) : null}

          {transport === "model" ? (
            <Roles
              defaults={settings.defaultRoles[id] ?? []}
              roles={roles}
              onChange={(next) => {
                setRoles(next);
                setDone("");
              }}
            />
          ) : null}

          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="label-caps">Модель</span>
              {provider === "anthropic" || transport === "http" ? (
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="mt-1.5 rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3 py-2 text-[13px] outline-none"
                >
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    value={model}
                    onChange={(e) => {
                      setModel(e.target.value);
                      setDone("");
                    }}
                    list={`models-${id}`}
                    spellCheck={false}
                    placeholder={DEFAULT_MODEL_OF[provider]}
                    className="mt-1.5 w-[240px] rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3 py-2 text-[13px] outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40"
                  />
                  <datalist id={`models-${id}`}>
                    {(MODEL_HINTS[provider] ?? []).map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </>
              )}
            </label>
            <button
              onClick={save}
              disabled={busy}
              className="btn btn-primary text-[13px] disabled:opacity-50"
            >
              {busy ? "Сохраняю" : "Сохранить"}
            </button>
            {transport === "model" || saved.endpoint ? (
              <button
                onClick={checkLink}
                disabled={busy}
                className="btn btn-glass text-[13px] disabled:opacity-50"
              >
                Проверить связь
              </button>
            ) : null}
            {done ? <span className="text-[12px] text-muted-foreground">{done}</span> : null}
          </div>

          {error ? (
            <div className="rounded-[10px] border border-[color:var(--color-error)] px-4 py-2.5 text-[12.5px] text-[color:var(--color-error)]">
              {error}
            </div>
          ) : null}

          <div className="border-t border-[color:var(--color-line)] pt-4">
            <div className="label-caps">Документы агента</div>
            <Attachments
              files={files}
              max={MAX_AGENT_FILES}
              onUpload={(file) => uploadAgentFile(code, id, file, onFiles)}
              onRemove={async (fileId) => {
                if (!code) return;
                onFiles(
                  (await deleteAgentFileServer({ data: { code, agentId: id, fileId } })).files,
                );
              }}
              onDownload={(f) =>
                code
                  ? downloadFileServer({
                      data: { code, scope: "agent", ownerId: id, fileId: f.id },
                    })
                  : Promise.resolve({ ok: false, name: "", mime: "", base64: "" })
              }
              empty="Документов нет"
            />
          </div>

          {test ? (
            <div className="rounded-[12px] border border-[color:var(--color-line)] px-4 py-3">
              <div className="label-caps">{test.ok ? "Связь есть" : "Связи нет"}</div>
              <p className="mt-1.5 text-[12.5px]">
                {test.ok ? test.text.slice(0, 400) : test.detail}
              </p>
              {test.raw ? (
                <details className="mt-2.5">
                  <summary className="cursor-pointer text-[11.5px] text-muted-foreground">
                    Сырой ответ сервиса
                  </summary>
                  <pre className="mt-2 max-h-[240px] overflow-auto rounded-[8px] bg-[color:var(--color-bg-secondary)] p-3 text-[11px] leading-relaxed">
                    {test.raw}
                  </pre>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Роли агента: от чьего лица он говорит.
 *
 * Обычный агент — один собеседник, и ролей у него нет. Здесь их несколько:
 * клиент приносит документ и прогоняет его по тем, кто будет решение
 * согласовывать. Инструкцию роли пишет методолог — она самодостаточна и
 * работает без общей инструкции агента.
 *
 * Имён и фамилий в ролях быть не должно: роль переиспользуется, а человек
 * в ней меняется — и персональные данные в настройках платформы нам не нужны.
 */
/**
 * Прогоны сборки документа.
 *
 * Каждый прогон — своя работа и своя модель: сборке нужна самая сильная,
 * правке языка — та, что иначе слышит русскую фразу, усушке — та, что склонна
 * резать. Выключенный прогон пропускается, текст идёт дальше как есть.
 */
function Passes({
  defaults,
  passes,
  keys,
  onChange,
}: {
  defaults: AgentPass[];
  passes: AgentPass[];
  keys: Record<Provider, KeyState>;
  onChange: (next: AgentPass[]) => void;
}) {
  const changed = JSON.stringify(defaults) !== JSON.stringify(passes);

  const patch = (i: number, field: keyof AgentPass, value: string | boolean) =>
    onChange(passes.map((p, n) => (n === i ? { ...p, [field]: value } : p)));

  return (
    <div className="border-t border-[color:var(--color-line)] pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="label-caps">Прогоны сборки</span>
        {defaults.length && changed ? (
          <button
            onClick={() => onChange(defaults)}
            className="text-[11.5px] text-muted-foreground underline underline-offset-4"
          >
            вернуть прогоны по умолчанию
          </button>
        ) : null}
      </div>
      <p className="measure mt-1 mb-3 text-[12.5px] text-muted-foreground">
        Идут по очереди, каждый получает текст предыдущего. Первый видит разбор с человеком и
        документы задачи, остальные работают только с текстом.
      </p>

      <div className="space-y-2.5">
        {passes.map((p, i) => (
          <details
            key={p.id}
            className="rounded-[12px] border border-[color:var(--color-line)] px-4 py-3"
          >
            <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 text-[13px]">
              <span className="font-medium">
                {i + 1}. {p.name || "Прогон без имени"}
                {p.enabled ? "" : " · выключен"}
              </span>
              <span
                className={`text-[11.5px] ${
                  p.enabled && !keys[p.provider]?.set
                    ? "text-[color:var(--color-error)]"
                    : "text-muted-foreground"
                }`}
              >
                {providerLabel(p.provider)} · {p.model}
                {p.enabled && !keys[p.provider]?.set
                  ? " · ключа нет, прогон не пройдёт"
                  : ` · инструкция ${p.prompt.length} знаков`}
              </span>
            </summary>

            <div className="mt-3 space-y-2.5">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <label className="block">
                  <span className="label-caps">Имя шага — его видит человек</span>
                  <input
                    value={p.name}
                    onChange={(e) => patch(i, "name", e.target.value)}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="label-caps">Модель</span>
                  <input
                    value={p.model}
                    onChange={(e) => patch(i, "model", e.target.value)}
                    spellCheck={false}
                    className={inputCls}
                  />
                </label>
              </div>

              <label className="block">
                <span className="label-caps">Одна строка: что делает прогон</span>
                <input
                  value={p.hint}
                  onChange={(e) => patch(i, "hint", e.target.value)}
                  className={inputCls}
                />
              </label>

              <div>
                <span className="label-caps">Чем думает</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {PROVIDERS.map((pr) => (
                    <button
                      key={pr.id}
                      onClick={() => patch(i, "provider", pr.id)}
                      className={`btn text-[12px] ${p.provider === pr.id ? "btn-primary" : "btn-glass"}`}
                    >
                      {pr.label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="block">
                <span className="label-caps">Инструкция прогона</span>
                <textarea
                  value={p.prompt}
                  onChange={(e) => patch(i, "prompt", e.target.value)}
                  rows={12}
                  className="mt-1.5 w-full resize-y rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3.5 py-3 text-[12.5px] leading-relaxed outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40"
                />
              </label>

              <button
                onClick={() => patch(i, "enabled", !p.enabled)}
                className="btn btn-ghost text-[12px]"
              >
                {p.enabled ? "Выключить прогон" : "Включить прогон"}
              </button>
            </div>
          </details>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] text-muted-foreground">
        Выключенный прогон пропускается: текст идёт дальше как есть. Прогон без имени или без
        инструкции не сохраняется.
      </p>
    </div>
  );
}

function Roles({
  defaults,
  roles,
  onChange,
}: {
  defaults: AgentRole[];
  roles: AgentRole[];
  onChange: (next: AgentRole[]) => void;
}) {
  const changed = JSON.stringify(defaults) !== JSON.stringify(roles);

  const patch = (i: number, field: keyof AgentRole, value: string) =>
    onChange(roles.map((r, n) => (n === i ? { ...r, [field]: value } : r)));

  return (
    <div className="border-t border-[color:var(--color-line)] pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="label-caps">Роли агента</span>
        {defaults.length && changed ? (
          <button
            onClick={() => onChange(defaults)}
            className="text-[11.5px] text-muted-foreground underline underline-offset-4"
          >
            вернуть роли по умолчанию
          </button>
        ) : null}
      </div>

      <div className="space-y-2.5">
        {roles.map((r, i) => (
          <details
            key={r.id}
            className="rounded-[12px] border border-[color:var(--color-line)] px-4 py-3"
          >
            <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 text-[13px]">
              <span className="font-medium">{r.name || "Роль без имени"}</span>
              <span className="text-[11.5px] text-muted-foreground">
                {r.group || "без группы"} · инструкция {r.prompt.length} знаков
              </span>
            </summary>

            <div className="mt-3 space-y-2.5">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <label className="block">
                  <span className="label-caps">Имя на кнопке</span>
                  <input
                    value={r.name}
                    onChange={(e) => patch(i, "name", e.target.value)}
                    className={inputCls}
                  />
                </label>
                <label className="block">
                  <span className="label-caps">Группа</span>
                  <input
                    value={r.group}
                    onChange={(e) => patch(i, "group", e.target.value)}
                    placeholder="служебная пометка"
                    className={inputCls}
                  />
                </label>
              </div>
              <label className="block">
                <span className="label-caps">Подпись под именем</span>
                <input
                  value={r.hint}
                  onChange={(e) => patch(i, "hint", e.target.value)}
                  placeholder="одна строка: что эта роль проверяет"
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="label-caps">Инструкция роли</span>
                <textarea
                  value={r.prompt}
                  onChange={(e) => patch(i, "prompt", e.target.value)}
                  rows={12}
                  className="mt-1.5 w-full resize-y rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3.5 py-3 text-[12.5px] leading-relaxed outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40"
                />
              </label>
              <button
                onClick={() => onChange(roles.filter((_, n) => n !== i))}
                className="btn btn-ghost text-[12px] text-[color:var(--color-error)]"
              >
                Убрать роль
              </button>
            </div>
          </details>
        ))}
      </div>

      <button
        onClick={() =>
          onChange([
            ...roles,
            {
              id: `role-${Math.random().toString(36).slice(2, 8)}`,
              name: "",
              hint: "",
              group: roles[roles.length - 1]?.group ?? "",
              prompt: "",
            },
          ])
        }
        className="btn btn-glass mt-3 text-[12px]"
      >
        Добавить роль
      </button>
    </div>
  );
}

/** Загрузка одного документа агенту: вернуть текст ошибки или пустую строку. */
async function uploadAgentFile(
  code: string | null,
  agentId: string,
  file: File,
  onFiles: (m: AgentFilesMap) => void,
): Promise<string> {
  if (!code) return "нет доступа";
  const form = new FormData();
  form.set("code", code);
  form.set("agentId", agentId);
  form.set("file", file);
  const res = await uploadAgentFileServer({ data: form });
  if (Object.keys(res.files).length) onFiles(res.files);
  return res.error;
}

const inputCls =
  "mt-1.5 w-full rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3 py-2 text-[13px] outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40";
