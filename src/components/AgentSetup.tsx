import { useEffect, useState } from "react";

import { useSession } from "@/lib/session";
import {
  DEFAULT_MODEL,
  MODELS,
  getAgentSettingsServer,
  normalizeConfig,
  saveAgentServer,
  saveApiKeyServer,
  testAgentServer,
  type AgentSettings,
  type Transport,
} from "@/lib/server-agents";
import { agents } from "@/lib/shtab-data";

/**
 * Настройка агентов: инструкция для каждого и один ключ модели на платформу.
 *
 * Ключ вводится один раз и обратно не показывается — только последние четыре
 * знака, чтобы убедиться, что он тот самый. Инструкция агента — обычный текст:
 * вставили из документа, сохранили, агент начал работать.
 */
export function AgentSetup() {
  const { code } = useSession();
  const [settings, setSettings] = useState<AgentSettings | null>(null);

  useEffect(() => {
    if (!code) return;
    getAgentSettingsServer({ data: { code } })
      .then(setSettings)
      .catch(() => setSettings({ agents: {}, keySet: false, keyTail: "" }));
  }, [code]);

  if (!settings) return <p className="text-[13px] text-muted-foreground">Загружаю…</p>;

  return (
    <div className="space-y-10">
      <ApiKey settings={settings} onSaved={setSettings} />

      <section>
        <h2 className="mb-1 text-[15px] font-semibold">Инструкции агентов</h2>
        <p className="measure mb-5 text-[12.5px] text-muted-foreground">
          Инструкция — это то, кем агент себя считает и как работает. Вставьте её текстом:
          пока поле пустое, агент честно скажет клиенту, что не настроен.
        </p>
        <div className="space-y-3">
          {agents.map((a) => (
            <AgentCard key={a.id} id={a.id} name={a.name} settings={settings} onSaved={setSettings} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ApiKey({ settings, onSaved }: { settings: AgentSettings; onSaved: (s: AgentSettings) => void }) {
  const { code } = useSession();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!code || !value.trim()) return;
    setBusy(true);
    try {
      onSaved(await saveApiKeyServer({ data: { code, key: value } }));
      setValue("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card-flat px-5 py-5">
      <h2 className="text-[15px] font-semibold">Ключ модели</h2>
      <p className="measure mt-1 text-[12.5px] text-muted-foreground">
        Один ключ на платформу. Хранится на сервере в РФ и в браузер не возвращается —
        поэтому ниже видно только последние знаки.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block min-w-[280px] flex-1">
          <span className="label-caps">{settings.keySet ? "Заменить ключ" : "Вставьте ключ"}</span>
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="sk-ant-…"
            autoComplete="off"
            spellCheck={false}
            className="mt-1.5 w-full rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3 py-2 text-[13px] outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40"
          />
        </label>
        <button onClick={save} disabled={busy || !value.trim()} className="btn btn-primary text-[13px] disabled:opacity-40">
          {busy ? "Сохраняю" : "Сохранить"}
        </button>
      </div>

      <p className="mt-3 text-[12px] text-muted-foreground">
        {settings.keySet ? (
          <>
            Ключ задан <span className="t-number text-[13px] tracking-[0.08em]">••••{settings.keyTail}</span>
          </>
        ) : (
          "Ключ не задан — агенты отвечать не смогут."
        )}
      </p>
    </section>
  );
}

function AgentCard({
  id,
  name,
  settings,
  onSaved,
}: {
  id: string;
  name: string;
  settings: AgentSettings;
  onSaved: (s: AgentSettings) => void;
}) {
  const { code } = useSession();
  const saved = normalizeConfig(settings.agents[id]);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(saved.prompt);
  const [model, setModel] = useState(saved.model || DEFAULT_MODEL);
  const [transport, setTransport] = useState<Transport>(saved.transport);
  const [endpoint, setEndpoint] = useState(saved.endpoint);
  const [authHeader, setAuthHeader] = useState(saved.authHeader);
  const [format, setFormat] = useState<"openai" | "simple">(saved.format);
  const [auth, setAuth] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; detail: string; raw: string; text: string } | null>(null);

  // Сохранили из другого места — подхватываем, пока карточка свёрнута.
  useEffect(() => {
    if (open) return;
    setPrompt(saved.prompt);
    setModel(saved.model || DEFAULT_MODEL);
    setTransport(saved.transport);
    setEndpoint(saved.endpoint);
    setAuthHeader(saved.authHeader);
    setFormat(saved.format);
  }, [open, saved.prompt, saved.model, saved.transport, saved.endpoint, saved.authHeader, saved.format]);

  async function save() {
    if (!code) return;
    setBusy(true);
    setDone(false);
    setTest(null);
    try {
      onSaved(
        await saveAgentServer({
          data: { code, agentId: id, prompt, model, transport, endpoint, authHeader, format, auth },
        }),
      );
      setAuth("");
      setDone(true);
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

  const where = saved.transport === "http" ? "ваш сервис" : MODELS.find((m) => m.id === saved.model)?.label ?? saved.model;

  return (
    <div className="card-flat px-5 py-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span className="text-[15px] font-semibold">{name}</span>
            <span
              className={`rounded-[var(--radius-pill)] border px-2 py-[2px] text-[10px] uppercase tracking-[0.12em] ${
                saved.enabled
                  ? "border-[color:var(--color-accent)] text-[color:var(--color-accent)]"
                  : "border-[color:var(--color-line)] text-muted-foreground"
              }`}
            >
              {saved.enabled ? "настроен" : "не настроен"}
            </span>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {saved.enabled
              ? saved.transport === "http"
                ? `${where} · ${saved.endpoint}`
                : `${where} · инструкция ${saved.prompt.length} знаков`
              : "клиент увидит, что агент не настроен"}
          </p>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="btn btn-glass text-[12.5px]">
          {open ? "Свернуть" : "Настроить"}
        </button>
      </div>

      {open ? (
        <div className="mt-5 space-y-4 border-t border-[color:var(--color-line)] pt-5">
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
                    placeholder={saved.authSet ? "задан — впишите новый, чтобы заменить" : "если сервис требует"}
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
                <select value={format} onChange={(e) => setFormat(e.target.value as "openai" | "simple")} className={inputCls}>
                  <option value="openai">Как у OpenAI — messages[], ответ в choices[0].message.content</option>
                  <option value="simple">Простой — шлём message + history, ответ ищем в reply / text / answer</option>
                </select>
              </label>

              <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                Не знаете формат — сохраните и нажмите «Проверить связь»: платформа покажет, что ответил
                сервис, и по этому ответу разбор допишется точно.
              </p>
            </div>
          ) : null}

          <label className="block">
            <span className="label-caps">
              {transport === "http" ? "Инструкция (уйдёт в сервис как системная, если он её принимает)" : "Инструкция агента"}
            </span>
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setDone(false);
              }}
              rows={transport === "http" ? 6 : 16}
              placeholder="Вставьте сюда текст инструкции: кто агент, что делает, в каком виде отдаёт результат"
              className="mt-1.5 w-full resize-y rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3.5 py-3 text-[13px] leading-relaxed outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40"
            />
          </label>

          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="label-caps">Модель</span>
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
            </label>
            <button onClick={save} disabled={busy} className="btn btn-primary text-[13px] disabled:opacity-50">
              {busy ? "Сохраняю" : "Сохранить"}
            </button>
            {transport === "http" && saved.endpoint ? (
              <button onClick={checkLink} disabled={busy} className="btn btn-glass text-[13px] disabled:opacity-50">
                Проверить связь
              </button>
            ) : null}
            {done ? <span className="text-[12px] text-muted-foreground">Сохранено</span> : null}
          </div>

          {test ? (
            <div className="rounded-[12px] border border-[color:var(--color-line)] px-4 py-3">
              <div className="label-caps">{test.ok ? "Связь есть" : "Связи нет"}</div>
              <p className="mt-1.5 text-[12.5px]">{test.ok ? test.text.slice(0, 400) : test.detail}</p>
              {test.raw ? (
                <details className="mt-2.5">
                  <summary className="cursor-pointer text-[11.5px] text-muted-foreground">Сырой ответ сервиса</summary>
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

const inputCls =
  "mt-1.5 w-full rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3 py-2 text-[13px] outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40";
