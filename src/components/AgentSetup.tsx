import { useEffect, useState } from "react";

import { useSession } from "@/lib/session";
import {
  DEFAULT_MODEL,
  MODELS,
  emptyConfig,
  getAgentSettingsServer,
  saveAgentServer,
  saveApiKeyServer,
  type AgentSettings,
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
  const saved = settings.agents[id] ?? emptyConfig();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(saved.prompt);
  const [model, setModel] = useState(saved.model || DEFAULT_MODEL);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Сохранили из другого места — подхватываем, пока поле не трогали.
  useEffect(() => {
    if (!open) {
      setPrompt(saved.prompt);
      setModel(saved.model || DEFAULT_MODEL);
    }
  }, [open, saved.prompt, saved.model]);

  async function save() {
    if (!code) return;
    setBusy(true);
    setDone(false);
    try {
      onSaved(await saveAgentServer({ data: { code, agentId: id, prompt, model } }));
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

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
              {saved.enabled ? "настроен" : "без инструкции"}
            </span>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {saved.enabled
              ? `${MODELS.find((m) => m.id === saved.model)?.label ?? saved.model} · инструкция ${saved.prompt.length} знаков`
              : "клиент увидит, что агент не настроен"}
          </p>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="btn btn-glass text-[12.5px]">
          {open ? "Свернуть" : saved.enabled ? "Изменить инструкцию" : "Вписать инструкцию"}
        </button>
      </div>

      {open ? (
        <div className="mt-5 space-y-3 border-t border-[color:var(--color-line)] pt-5">
          <label className="block">
            <span className="label-caps">Инструкция агента</span>
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setDone(false);
              }}
              rows={16}
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
            {done ? <span className="text-[12px] text-muted-foreground">Сохранено</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
