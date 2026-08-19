import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";

import { AppShell, PageHead } from "@/components/AppShell";
import {
  accessCodes as seedCodes,
  clients,
  people as seedPeople,
  personOf,
  roleLabel,
  silentDays,
  type AccessCode,
  type Person,
  type Role,
} from "@/lib/platform-data";
import { agents } from "@/lib/shtab-data";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Кабинет администратора — платформа «Без Воды»" },
      { name: "description", content: "Доступы, клиенты и агенты платформы." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminCabinet,
});

const tabs = [
  { key: "overview", label: "Обзор" },
  { key: "access", label: "Доступы" },
  { key: "agents", label: "Агенты" },
] as const;
type TabKey = (typeof tabs)[number]["key"];

function AdminCabinet() {
  return (
    <AppShell allow={["admin"]}>
      <Body />
    </AppShell>
  );
}

function Body() {
  const [tab, setTab] = useState<TabKey>("overview");

  return (
    <>
      <PageHead
        n="01"
        eyebrow="Кабинет администратора"
        title="Как идёт платформа"
        lead="Доступы, клиенты и агенты. Оплата приходит по счёту — доступ открываете вы."
      />

      <div className="-mx-1 overflow-x-auto pb-1">
        <div
          role="tablist"
          aria-label="Разделы кабинета"
          className="flex min-w-max items-center gap-1 rounded-[var(--radius-pill)] border border-[color:var(--color-line)] p-1"
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-[var(--radius-pill)] px-3.5 py-1.5 text-[12.5px] transition-colors ${
                tab === t.key ? "lg lg-strong font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-7">
        {tab === "overview" ? <Overview /> : null}
        {tab === "access" ? <Access /> : null}
        {tab === "agents" ? <AgentPanel /> : null}
      </div>
    </>
  );
}

// ── Обзор ─────────────────────────────────────────────────────────────────────
/**
 * Пока платформа не работает по-настоящему, честно показывать только то,
 * что действительно известно: сколько заведено и чего ещё нет. Учёт расхода
 * вернётся сюда вместе с настоящим счётчиком, а не раньше.
 */
function Overview() {
  const withAccess = seedCodes.filter((c) => c.active).length;
  const openedAgents = clients.reduce((s, c) => s + c.agentIds.length, 0);
  const silent = clients.filter((c) => silentDays(c) > 14);

  const todo = [
    agents.length === 0 ? "Завести агентов в каталоге" : null,
    openedAgents === 0 ? "Открыть клиентам их набор агентов" : null,
    clients.length === 0 ? "Завести первого клиента" : null,
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-10">
      <section className="grid gap-6 border-y border-[color:var(--color-line)] py-6 sm:grid-cols-3">
        <Stat n={clients.length} label="Клиентов на платформе" />
        <Stat n={withAccess} label="Человек с доступом" />
        <Stat n={agents.length} label="Агентов в каталоге" />
      </section>

      {todo.length ? (
        <section>
          <h2 className="mb-1 text-[15px] font-semibold">Что настроить</h2>
          <p className="measure mb-4 text-[12.5px] text-muted-foreground">
            Платформа готова, наполнения ещё нет. Пока эти пункты не закрыты, клиент в своём кабинете
            увидит пустое окно.
          </p>
          <ol className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
            {todo.map((t, i) => (
              <li key={t} className="flex gap-4 py-3.5">
                <span className="t-number w-6 flex-none text-[11px] tabular-nums text-muted-foreground/70">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="text-[14px]">{t}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section>
        <h2 className="mb-1 text-[15px] font-semibold">Замолчали</h2>
        <p className="measure mb-4 text-[12.5px] text-muted-foreground">
          Купили и не заходят — это про отток, а не про экономию. Каждая строка здесь стоит одного звонка.
        </p>
        {silent.length ? (
          <ul className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
            {silent.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-3 py-3.5">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium leading-snug">{c.company}</div>
                  <div className="text-[12px] text-muted-foreground">
                    ведёт {personOf(c.managerId)?.name} · открыто агентов {c.agentIds.length}
                  </div>
                </div>
                <span className="text-[13px] text-[color:var(--color-accent)]">
                  {silentDays(c)} {declension(silentDays(c), "день", "дня", "дней")} тишины
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">Все заходили на этой неделе.</p>
        )}
      </section>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="t-number text-[34px] leading-none tabular-nums">{n}</div>
      <div className="mt-1.5 text-[12.5px] text-muted-foreground">{label}</div>
    </div>
  );
}

// ── Доступы ───────────────────────────────────────────────────────────────────
/** Выдача логинов: новый человек + код. Регистрации нет — только ваша рука. */
function Access() {
  const [codes, setCodes] = useState<AccessCode[]>(seedCodes);
  const [staff, setStaff] = useState<Person[]>(seedPeople);
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [role, setRole] = useState<Role>("client");
  const [clientId, setClientId] = useState<string>(clients[0]?.id ?? "");
  const [issued, setIssued] = useState<string | null>(null);

  function issue(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    const personId = `p-${Date.now().toString(36)}`;
    const code = makeCode(role, name, clientId);
    setStaff((p) => [
      ...p,
      {
        id: personId,
        name: name.trim(),
        position: position.trim() || roleLabel[role],
        role,
        clientId: role === "client" ? clientId : null,
      },
    ]);
    setCodes((p) => [{ code, personId, issuedAt: today(), lastUsedAt: null, active: true }, ...p]);
    setIssued(code);
    setName("");
    setPosition("");
  }

  const revoke = (code: string) =>
    setCodes((p) => p.map((c) => (c.code === code ? { ...c, active: false } : c)));

  return (
    <div className="space-y-10">
      <section className="card-flat px-5 py-5">
        <h2 className="text-[15px] font-semibold">Выдать доступ</h2>
        <p className="measure mt-1 text-[12.5px] text-muted-foreground">
          Код — это логин, пароля нет. Один код на одного человека: видно, кто заходил, и код можно отозвать,
          не трогая остальных.
        </p>

        <form onSubmit={issue} className="mt-5 grid gap-3 sm:grid-cols-2">
          <Field label="Имя и фамилия">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя Фамилия" className={inputCls} />
          </Field>
          <Field label="Должность">
            <input
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="Коммерческий директор"
              className={inputCls}
            />
          </Field>
          <Field label="Роль">
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={inputCls}>
              <option value="client">Клиент — работает в окнах</option>
              <option value="project">Проджект — ведёт клиентов</option>
              <option value="admin">Администратор — всё</option>
            </select>
          </Field>
          <Field label="Компания">
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              disabled={role !== "client"}
              className={`${inputCls} disabled:opacity-40`}
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company}
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <button type="submit" className="btn btn-primary text-[13px]">
              Выпустить код
            </button>
          </div>
        </form>

        {issued ? (
          <div className="mt-4 border-t border-[color:var(--color-line)] pt-4">
            <div className="label-caps">Код выпущен — передайте лично</div>
            <div className="t-number mt-1.5 text-[20px] tracking-[0.08em]">{issued}</div>
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">
              На сервере код будет храниться зашифрованным: посмотреть можно, утечь базой — нет.
            </p>
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="mb-4 text-[15px] font-semibold">Кто имеет доступ</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[color:var(--color-line)] text-left">
                <Th>Человек</Th>
                <Th>Роль</Th>
                <Th>Компания</Th>
                <Th>Код</Th>
                <Th>Последний вход</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const p = staff.find((x) => x.id === c.personId);
                const client = clients.find((x) => x.id === p?.clientId);
                return (
                  <tr key={c.code} className="border-b border-[color:var(--color-line)]">
                    <Td>
                      <div className={c.active ? "" : "text-muted-foreground line-through"}>{p?.name ?? "—"}</div>
                      <div className="text-[11.5px] text-muted-foreground">{p?.position}</div>
                    </Td>
                    <Td>{p ? roleLabel[p.role] : "—"}</Td>
                    <Td>{client ? client.company : "«Без Воды»"}</Td>
                    <Td>
                      <span className="t-number text-[12px] tracking-[0.06em]">{c.code}</span>
                    </Td>
                    <Td>{c.lastUsedAt ?? <span className="text-muted-foreground">ни разу</span>}</Td>
                    <Td>
                      {c.active ? (
                        <button onClick={() => revoke(c.code)} className="btn btn-ghost text-[12px]">
                          Отозвать
                        </button>
                      ) : (
                        <span className="text-[11.5px] text-muted-foreground">отозван</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ── Агенты ────────────────────────────────────────────────────────────────────
/** Кому что открыто. Решение об открытии — ваше, клиент себе агента не включает. */
function AgentPanel() {
  const [map, setMap] = useState<Record<string, string[]>>(
    Object.fromEntries(clients.map((c) => [c.id, c.agentIds])),
  );
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const client = clients.find((c) => c.id === clientId);

  const toggle = (agentId: string) =>
    setMap((p) => {
      const cur = p[clientId] ?? [];
      return { ...p, [clientId]: cur.includes(agentId) ? cur.filter((x) => x !== agentId) : [...cur, agentId] };
    });

  if (agents.length === 0) {
    return (
      <div className="card-flat px-6 py-10 text-center">
        <h2 className="text-[16px] font-semibold">Каталог пуст</h2>
        <p className="measure mx-auto mt-2.5 text-[13.5px] text-muted-foreground">
          Агентов ещё не завели. Когда они появятся, здесь вы будете открывать каждому клиенту свой набор —
          по своему усмотрению, а не пакетом.
        </p>
      </div>
    );
  }

  const opened = map[clientId] ?? [];

  return (
    <div>
      <h2 className="mb-1 text-[15px] font-semibold">Кому какие агенты открыты</h2>
      <p className="measure mb-5 text-[12.5px] text-muted-foreground">
        Каталог общий, но набор у каждого клиента свой — вы решаете, что ему нужно. Открытый агент
        появляется у клиента в окне сразу.
      </p>

      <div className="flex flex-wrap gap-2">
        {clients.map((c) => (
          <button
            key={c.id}
            onClick={() => setClientId(c.id)}
            className={`btn text-[12.5px] ${c.id === clientId ? "btn-primary" : "btn-glass"}`}
          >
            {c.company}
            <span className="ml-1.5 opacity-60">{(map[c.id] ?? []).length}</span>
          </button>
        ))}
      </div>

      {client ? (
        <p className="mt-4 text-[12.5px] text-muted-foreground">
          {client.unit} · открыто {opened.length}
        </p>
      ) : null}

      <div className="mt-5 space-y-5">
        {groupByDomain().map(([domainName, list]) => (
          <div key={domainName}>
            <div className="label-caps">{domainName}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {list.map((a) => (
                <button
                  key={a.id}
                  onClick={() => toggle(a.id)}
                  aria-pressed={opened.includes(a.id)}
                  title={a.result}
                  className={`btn text-[12px] ${opened.includes(a.id) ? "btn-primary" : "btn-glass"}`}
                >
                  {a.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Мелочи ────────────────────────────────────────────────────────────────────

const inputCls =
  "mt-1.5 w-full rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3 py-2 text-[13px] outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label-caps">{label}</span>
      {children}
    </label>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="label-caps whitespace-nowrap py-2.5 pr-4 font-normal">{children}</th>;
}

function Td({ children }: { children: ReactNode }) {
  return <td className="py-3 pr-4 align-top">{children}</td>;
}

/** Группировка агентов по блокам каталога — чтобы список читался. */
function groupByDomain() {
  const groups = new Map<string, typeof agents>();
  for (const a of agents) groups.set(a.domain, [...(groups.get(a.domain) ?? []), a]);
  return [...groups.entries()].map(([key, list]) => [domainNames[key] ?? key, list] as const);
}

const domainNames: Record<string, string> = {
  rezultaty: "Результаты и причины",
  dengi: "Деньги и финансы",
  klienty: "Клиенты и продажи",
  produkt: "Продукт и цена",
  operacii: "Операции и поставки",
  rynok: "Рынок и конкуренты",
  iniciativy: "Инициативы и проекты",
  riski: "Риски и соответствие",
  organizaciya: "Организация работы",
  strategiya: "Стратегия и развитие",
  gorizont: "Для всех блоков",
};

const today = () => new Date().toLocaleDateString("ru-RU");

/** Код в одном формате: префикс компании и фамилия латиницей. */
function makeCode(role: Role, name: string, clientId: string) {
  const surname = name.trim().split(/\s+/).pop() ?? "USER";
  const prefix =
    role === "client" ? (clients.find((c) => c.id === clientId)?.company.slice(0, 3) ?? "CL") : "BV";
  return `${translit(prefix).toUpperCase() || "CL"}-${translit(surname).toUpperCase()}`;
}

const translitMap: Record<string, string> = {
  а: "A", б: "B", в: "V", г: "G", д: "D", е: "E", ё: "E", ж: "ZH", з: "Z", и: "I", й: "Y",
  к: "K", л: "L", м: "M", н: "N", о: "O", п: "P", р: "R", с: "S", т: "T", у: "U", ф: "F",
  х: "H", ц: "C", ч: "CH", ш: "SH", щ: "SCH", ъ: "", ы: "Y", ь: "", э: "E", ю: "YU", я: "YA",
};

const translit = (s: string) =>
  s
    .toLowerCase()
    .split("")
    .map((ch) => translitMap[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]/gi, "");

const declension = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
};

