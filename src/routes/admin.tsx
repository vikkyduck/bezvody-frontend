import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { AppShell, PageHead } from "@/components/AppShell";
import {
  accessCodes as seedCodes,
  clients,
  costRub,
  creditsLeft,
  creditsPct,
  marginRub,
  nf,
  people as seedPeople,
  personOf,
  roleLabel,
  rub,
  silentDays,
  usage,
  usageOf,
  type AccessCode,
  type Client,
  type Person,
  type Role,
} from "@/lib/platform-data";
import { agents } from "@/lib/shtab-data";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Кабинет администратора — платформа «Без Воды»" },
      { name: "description", content: "Доступы, кредиты и агенты по всем клиентам платформы." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminCabinet,
});

const tabs = [
  { key: "overview", label: "Обзор" },
  { key: "access", label: "Доступы" },
  { key: "credits", label: "Кредиты" },
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
        lead="Доступы, деньги и агенты по всем клиентам. Оплата приходит по счёту — доступ открываете вы."
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
        {tab === "credits" ? <Credits /> : null}
        {tab === "agents" ? <AgentPanel /> : null}
      </div>
    </>
  );
}

// ── Обзор ─────────────────────────────────────────────────────────────────────
/**
 * Четыре вопроса, на которые владельцу платформы нужен ответ каждый день:
 * сколько зарабатываем, кому пора выставить счёт, кто отваливается,
 * что из каталога живо. Всё остальное — детали, они на других вкладках.
 */
function Overview() {
  const invoiced = clients.reduce((s, c) => s + c.invoiceRub, 0);
  const spentCredits = clients.reduce((s, c) => s + c.creditsUsed, 0);
  const cost = costRub(spentCredits);
  const margin = invoiced - cost;
  const marginPct = Math.round((margin / invoiced) * 100);

  // Пора выставлять счёт: кредиты на исходе или доступ заканчивается.
  const toInvoice = clients.filter((c) => creditsPct(c) >= 75 || daysLeft(c.paidUntil) <= 45);
  const silent = clients.filter((c) => silentDays(c) > 14);

  const byAgent = useMemo(() => {
    const map = new Map<string, { runs: number; credits: number; clients: number }>();
    for (const u of usage) {
      const cur = map.get(u.agentId) ?? { runs: 0, credits: 0, clients: 0 };
      map.set(u.agentId, { runs: cur.runs + u.runs, credits: cur.credits + u.credits, clients: cur.clients + 1 });
    }
    return [...map.entries()].sort((a, b) => b[1].runs - a[1].runs);
  }, []);

  const dead = byAgent.filter(([, v]) => v.runs === 0);

  return (
    <div className="space-y-10">
      <section className="border-y border-[color:var(--color-line)] py-6">
        <div className="label-caps">Деньги за период</div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="t-number text-[44px] leading-none tabular-nums sm:text-[52px]">{rub(margin)}</span>
          <span className="text-[15px] text-muted-foreground">осталось после расходов на модели · {marginPct} %</span>
        </div>
        <p className="measure mt-3 text-[12.5px] text-muted-foreground">
          Выставлено по счетам {rub(invoiced)} · израсходовано {nf(spentCredits)} кредитов, это {rub(cost)} прямых
          расходов. Кредит считаем по себестоимости токенов, без наценки — так видно настоящую маржу.
        </p>
      </section>

      <section>
        <h2 className="mb-1 text-[15px] font-semibold">Пора выставить счёт</h2>
        <p className="measure mb-4 text-[12.5px] text-muted-foreground">
          Кредиты на исходе или доступ заканчивается в ближайшие полтора месяца. Оплата по счёту — значит,
          счёт должен уйти раньше, чем клиент упрётся в ноль.
        </p>
        {toInvoice.length ? (
          <ul className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
            {toInvoice.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-3 py-3.5">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium leading-snug">{c.company}</div>
                  <div className="text-[12px] text-muted-foreground">
                    израсходовано {creditsPct(c)} % · доступ до {c.paidUntil}
                  </div>
                </div>
                <span className="t-number text-[13px] tabular-nums text-muted-foreground">
                  {nf(creditsLeft(c))} кредитов
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">Ни у кого не горит.</p>
        )}
      </section>

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

      <section>
        <h2 className="mb-1 text-[15px] font-semibold">Что из каталога живо</h2>
        <p className="measure mb-4 text-[12.5px] text-muted-foreground">
          Агент без запусков — это не проданный агент, а обещание, которое не сработало. Такие или
          переобъяснять, или снимать с витрины.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <div className="label-caps">Запускают чаще всего</div>
            <ul className="mt-2.5 divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
              {byAgent.slice(0, 5).map(([id, v]) => (
                <li key={id} className="flex items-baseline justify-between gap-3 py-2.5">
                  <span className="min-w-0 truncate text-[13px]">{agents.find((a) => a.id === id)?.name ?? id}</span>
                  <span className="t-number flex-none text-[12px] tabular-nums text-muted-foreground">
                    {v.runs}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="label-caps">Подключены, но ни разу не запущены</div>
            <ul className="mt-2.5 divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
              {dead.map(([id]) => (
                <li key={id} className="py-2.5 text-[13px]">
                  {agents.find((a) => a.id === id)?.name ?? id}
                </li>
              ))}
              {dead.length === 0 ? <li className="py-2.5 text-[13px] text-muted-foreground">Таких нет.</li> : null}
            </ul>
          </div>
        </div>
      </section>
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
    setCodes((p) => [
      { code, personId, issuedAt: today(), lastUsedAt: null, active: true },
      ...p,
    ]);
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
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Анна Ковалёва"
              className={inputCls}
            />
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

// ── Кредиты ───────────────────────────────────────────────────────────────────
/** Аудит по каждому клиенту: что выдано, что израсходовано, что осталось нам. */
function Credits() {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div>
      <h2 className="mb-1 text-[15px] font-semibold">Аудит кредитов по клиентам</h2>
      <p className="measure mb-5 text-[12.5px] text-muted-foreground">
        Выдано — сколько кредитов открыто по счёту. Себестоимость — сколько эта работа стоила нам у моделей.
        Разница и есть то, что остаётся платформе.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-[color:var(--color-line)] text-left">
              <Th>Клиент</Th>
              <Th right>Выдано</Th>
              <Th right>Израсходовано</Th>
              <Th right>Осталось</Th>
              <Th right>По счёту</Th>
              <Th right>Себестоимость</Th>
              <Th right>Остаётся нам</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <Fragment key={c.id}>
                <tr className="border-b border-[color:var(--color-line)]">
                  <Td>
                    <div className="font-medium">{c.company}</div>
                    <div className="text-[11.5px] text-muted-foreground">
                      {c.unit} · ведёт {personOf(c.managerId)?.name}
                    </div>
                  </Td>
                  <Td right>{nf(c.creditsGranted)}</Td>
                  <Td right>
                    {nf(c.creditsUsed)}
                    <span className="ml-1.5 text-[11px] text-muted-foreground">{creditsPct(c)} %</span>
                  </Td>
                  <Td right>{nf(creditsLeft(c))}</Td>
                  <Td right>{rub(c.invoiceRub)}</Td>
                  <Td right>{rub(costRub(c.creditsUsed))}</Td>
                  <Td right>
                    <span className="font-semibold">{rub(marginRub(c))}</span>
                  </Td>
                  <Td>
                    <button
                      onClick={() => setOpen(open === c.id ? null : c.id)}
                      className="btn btn-ghost text-[12px]"
                    >
                      {open === c.id ? "Свернуть" : "По агентам"}
                    </button>
                  </Td>
                </tr>
                {open === c.id ? (
                  <tr>
                    <td colSpan={8} className="border-b border-[color:var(--color-line)] px-1 py-4">
                      <ul className="divide-y divide-[color:var(--color-line)]">
                        {usageOf(c.id).map((u) => (
                          <li key={u.agentId} className="flex items-baseline justify-between gap-4 py-2">
                            <span className="text-[12.5px]">{agents.find((a) => a.id === u.agentId)?.name}</span>
                            <span className="flex items-baseline gap-5 text-[12px] text-muted-foreground">
                              <span className="tabular-nums">{u.runs} зап.</span>
                              <span className="t-number w-[84px] text-right text-[12.5px] tabular-nums text-foreground">
                                {nf(u.credits)}
                              </span>
                              <span className="w-[92px] text-right tabular-nums">{rub(costRub(u.credits))}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
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
  const client = clients.find((c) => c.id === clientId) as Client;
  const opened = map[clientId] ?? [];

  const toggle = (agentId: string) =>
    setMap((p) => {
      const cur = p[clientId] ?? [];
      return { ...p, [clientId]: cur.includes(agentId) ? cur.filter((x) => x !== agentId) : [...cur, agentId] };
    });

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

      <p className="mt-4 text-[12.5px] text-muted-foreground">
        {client.unit} · {opened.length} открыто · израсходовано {nf(client.creditsUsed)} кредитов
      </p>

      <div className="mt-5 space-y-5">
        {groupByDomain(opened).map(([domainName, list]) => (
          <div key={domainName}>
            <div className="label-caps">{domainName}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {list.map((a) => {
                const on = opened.includes(a.id);
                const used = usageOf(clientId).find((u) => u.agentId === a.id);
                return (
                  <button
                    key={a.id}
                    onClick={() => toggle(a.id)}
                    aria-pressed={on}
                    title={a.result}
                    className={`btn text-[12px] ${on ? "btn-primary" : "btn-glass"}`}
                  >
                    {a.name}
                    {used && used.runs > 0 ? <span className="ml-1.5 opacity-60">{used.runs}</span> : null}
                  </button>
                );
              })}
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

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <th className={`label-caps whitespace-nowrap py-2.5 pr-4 font-normal ${right ? "text-right" : ""}`}>
      {children}
    </th>
  );
}

function Td({ children, right }: { children: ReactNode; right?: boolean }) {
  // t-number — дисплейное начертание цифр: в таблице ему нужен явный кегль,
  // иначе строка разъезжается на пол-экрана.
  return (
    <td className={`py-3 pr-4 align-top ${right ? "t-number whitespace-nowrap text-right text-[13px] tabular-nums" : ""}`}>
      {children}
    </td>
  );
}

/** Группировка открытых агентов по блокам каталога — чтобы список читался. */
function groupByDomain(opened: string[]) {
  const groups = new Map<string, typeof agents>();
  for (const a of agents) {
    const key = a.domain;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  return [...groups.entries()]
    .map(([key, list]) => {
      const name = domainName(key);
      return [name, list] as const;
    })
    // Сначала блоки, где клиенту уже что-то открыто.
    .sort((a, b) => countOpen(b[1], opened) - countOpen(a[1], opened));
}

const countOpen = (list: typeof agents, opened: string[]) => list.filter((a) => opened.includes(a.id)).length;

function domainName(key: string) {
  const found = domainsByKey[key];
  return found ?? key;
}

const domainsByKey: Record<string, string> = {
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

/** Код в одном формате: префикс компании, фамилия, две случайные цифры. */
function makeCode(role: Role, name: string, clientId: string) {
  const surname = name.trim().split(/\s+/).pop() ?? "USER";
  const prefix =
    role === "client" ? (clients.find((c) => c.id === clientId)?.company.slice(1, 4) ?? "CL") : "BV";
  return `${translit(prefix).toUpperCase()}-${translit(surname).toUpperCase()}`;
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

/** Сколько дней до даты в формате ДД.ММ.ГГГГ. */
function daysLeft(ddmmyyyy: string, from = "2026-08-16") {
  const [d, m, y] = ddmmyyyy.split(".").map(Number);
  return Math.round((Date.parse(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`) - Date.parse(from)) / 86400000);
}
