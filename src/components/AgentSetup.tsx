import { useEffect, useState } from "react";

import { DEFAULT_ROLES, type AgentRole } from "@/lib/roles";

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
  getAgentSettingsServer,
  normalizeConfig,
  rolesOf,
  saveAgentServer,
  saveApiKeyServer,
  testAgentServer,
  type AgentSettings,
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
      .catch(() => setSettings({ agents: {}, keySet: false, keyTail: "" }));
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
        <p className="measure mb-5 text-[12.5px] text-muted-foreground">
          Инструкция — это то, кем агент себя считает и как работает. Вставьте её текстом:
          пока поле пустое, агент честно скажет клиенту, что не настроен.
        </p>
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
  const [endpoint, setEndpoint] = useState(saved.endpoint);
  const [authHeader, setAuthHeader] = useState(saved.authHeader);
  const [format, setFormat] = useState<"openai" | "simple">(saved.format);
  const [auth, setAuth] = useState("");
  const savedRoles = rolesOf(id, settings.agents[id]);
  const [roles, setRoles] = useState<AgentRole[]>(savedRoles);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; detail: string; raw: string; text: string } | null>(null);

  // Сохранили из другого места — подхватываем, пока карточка свёрнута.
  useEffect(() => {
    if (open) return;
    setPrompt(saved.prompt);
    setFinishRule(saved.finishRule);
    setModel(saved.model || DEFAULT_MODEL);
    setTransport(saved.transport);
    setEndpoint(saved.endpoint);
    setAuthHeader(saved.authHeader);
    setFormat(saved.format);
    setRoles(savedRoles);
    // savedRoles — новый массив на каждый рендер, поэтому в зависимостях он
    // строкой: иначе эффект переустанавливал бы состояние без конца.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    open,
    saved.prompt,
    saved.finishRule,
    saved.model,
    saved.transport,
    saved.endpoint,
    saved.authHeader,
    saved.format,
    JSON.stringify(savedRoles),
  ]);

  async function save() {
    if (!code) return;
    setBusy(true);
    setDone(false);
    setTest(null);
    try {
      onSaved(
        await saveAgentServer({
          data: { code, agentId: id, prompt, finishRule, model, transport, endpoint, authHeader, format, auth, roles },
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
                saved.enabled || savedRoles.length
                  ? "border-[color:var(--color-accent)] text-[color:var(--color-accent)]"
                  : "border-[color:var(--color-line)] text-muted-foreground"
              }`}
            >
              {saved.enabled || savedRoles.length ? "настроен" : "не настроен"}
            </span>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {saved.enabled || savedRoles.length
              ? saved.transport === "http"
                ? `${where} · ${saved.endpoint}`
                : saved.prompt.length
                  ? `${where} · инструкция ${saved.prompt.length} знаков`
                  : where
              : "клиент увидит, что агент не настроен"}
            {savedRoles.length ? ` · ролей ${savedRoles.length}` : ""}
            {files.length ? ` · документов ${files.length}` : ""}
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
            <p className="measure mt-1 text-[12px] text-muted-foreground">
              Дописывается к инструкции последним абзацем. Нужно ради одного: агент доходил до
              рекомендаций и останавливался — уточнял, предлагал собрать документ «если нужно», —
              и человек оставался с перепиской. Неполный документ можно дополнить, отсутствующий — нет.
              Очистите поле, если этому агенту правило мешает.
            </p>
            <textarea
              value={finishRule}
              onChange={(e) => {
                setFinishRule(e.target.value);
                setDone(false);
              }}
              rows={7}
              placeholder="Пусто — агент заканчивает работу так, как решит сам"
              className="mt-2 w-full resize-y rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3.5 py-3 text-[12.5px] leading-relaxed outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40"
            />
          </div>

          {transport === "model" ? (
            <Roles
              agentId={id}
              roles={roles}
              onChange={(next) => {
                setRoles(next);
                setDone(false);
              }}
            />
          ) : null}

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

          <div className="border-t border-[color:var(--color-line)] pt-4">
            <div className="label-caps">Документы агента</div>
            <p className="measure mt-1 mb-3 text-[12.5px] text-muted-foreground">
              Методика, стандарт, шаблон — то, что агент должен знать всегда. Уходят к нему при
              каждом вопросе любого клиента. Сохранять отдельно не нужно: файл встаёт на место сразу.
            </p>
            <Attachments
              files={files}
              max={MAX_AGENT_FILES}
              onUpload={(file) => uploadAgentFile(code, id, file, onFiles)}
              onRemove={async (fileId) => {
                if (!code) return;
                onFiles((await deleteAgentFileServer({ data: { code, agentId: id, fileId } })).files);
              }}
              onDownload={(f) =>
                code
                  ? downloadFileServer({ data: { code, scope: "agent", ownerId: id, fileId: f.id } })
                  : Promise.resolve({ ok: false, name: "", mime: "", base64: "" })
              }
              empty="Документов нет — агент работает по одной инструкции."
            />
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
function Roles({
  agentId,
  roles,
  onChange,
}: {
  agentId: string;
  roles: AgentRole[];
  onChange: (next: AgentRole[]) => void;
}) {
  const defaults = DEFAULT_ROLES[agentId] ?? [];
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
      <p className="measure mt-1 mb-3 text-[12.5px] text-muted-foreground">
        {roles.length
          ? "Клиент видит их кнопками в своём окне и прогоняет документ по одной роли за раз. Инструкция роли самодостаточна: общую инструкцию агента можно оставить пустой. Фамилий в ролях не пишем — роль переиспользуется, а человек в ней меняется."
          : "У этого агента ролей нет — он отвечает сам от себя. Добавьте роль, если нужен разговор от лица согласующих."}
      </p>

      <div className="space-y-2.5">
        {roles.map((r, i) => (
          <details key={r.id} className="rounded-[12px] border border-[color:var(--color-line)] px-4 py-3">
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
                  <input value={r.name} onChange={(e) => patch(i, "name", e.target.value)} className={inputCls} />
                </label>
                <label className="block">
                  <span className="label-caps">Группа</span>
                  <input
                    value={r.group}
                    onChange={(e) => patch(i, "group", e.target.value)}
                    placeholder="например: Лестница согласования"
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
      <p className="mt-2 text-[11.5px] text-muted-foreground">
        Роль без имени или без инструкции не сохраняется. Правила разговора — короткие ответы,
        два-три вопроса за заход и прямой отказ, если документ роль не касается, — платформа
        дописывает сама, повторять их в каждой роли не нужно.
      </p>
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
