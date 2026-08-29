import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";

import { AppShell, PageHead } from "@/components/AppShell";
import { AgentAccess } from "@/components/AgentAccess";
import { AgentSetup } from "@/components/AgentSetup";
import { Chevron, Reveal } from "@/components/bv/Reveal";
import { agents } from "@/lib/shtab-data";
import { Conversations } from "@/components/Conversations";
import { Reports } from "@/components/Reports";
import { cleanTelegram, useDirectory, type Participant } from "@/lib/directory";
import { roleLabel, type Role } from "@/lib/platform-data";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Администрирование — NOWATER.TECH" },
      { name: "description", content: "Участники, доступы и агенты платформы NOWATER.TECH." },
      { property: "og:title", content: "Администрирование — NOWATER.TECH" },
      {
        property: "og:description",
        content: "Участники, доступы и агенты платформы NOWATER.TECH.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminCabinet,
});

const tabs = [
  { key: "people", label: "Участники" },
  { key: "reports", label: "Отчёты" },
  { key: "agents", label: "Агенты" },
  { key: "overview", label: "Обзор" },
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
  const [tab, setTab] = useState<TabKey>("people");

  return (
    <>
      <PageHead n="01" eyebrow="Кабинет администратора" title="Кто работает на платформе" />

      {/* Вкладки — строка слов на общей линии, активное подчёркнуто.
          Обводка вокруг всей ленты рисовала коробку там, где её нет. */}
      <div className="-mx-1 overflow-x-auto border-b border-[color:var(--color-line)]">
        <div
          role="tablist"
          aria-label="Разделы кабинета"
          className="flex min-w-max items-center gap-8 px-1"
        >
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`relative -mb-px py-3 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                tab === t.key
                  ? "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-12">
        {tab === "people" ? <People /> : null}
        {tab === "reports" ? <Reports /> : null}
        {tab === "agents" ? <AgentSetup /> : null}
        {tab === "overview" ? <Overview /> : null}
      </div>
    </>
  );
}

// ── Участники ─────────────────────────────────────────────────────────────────
/**
 * Личный кабинет заводится здесь и только здесь: регистрации нет.
 * Код показывается один раз крупно и копируется — передаёте его сами,
 * ни почта, ни телеграм отсюда ничего не отправляют.
 * Дальше в списке он закрыт: этот экран показывают на встречах и созвонах,
 * а открытый список кодов — это разом отданные чужие входы.
 */
function People() {
  const { participants } = useDirectory();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-10">
      <NewParticipant onCreated={(p) => setOpenId(p.id)} />

      <section>
        <h2 className="ui-h2 mb-4">
          Личные кабинеты <span className="text-muted-foreground">· {participants.length}</span>
        </h2>
        <div className="stagger space-y-2.5">
          {participants.map((p) => (
            <PersonCard
              key={p.id}
              person={p}
              open={openId === p.id}
              onToggle={() => setOpenId(openId === p.id ? null : p.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function NewParticipant({ onCreated }: { onCreated: (p: Participant) => void }) {
  const { add } = useDirectory();
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [telegram, setTelegram] = useState("");
  const [role, setRole] = useState<Role>("client");
  const [issued, setIssued] = useState<Participant | null>(null);
  const [copied, setCopied] = useState(false);

  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const created = await add({ name, position, company, email, telegram, role });
    setBusy(false);
    if (!created) return;
    setIssued(created);
    setCopied(false);
    onCreated(created);
    setName("");
    setPosition("");
    setCompany("");
    setEmail("");
    setTelegram("");
  }

  return (
    <section className="border-b border-[color:var(--color-line)] pb-10">
      <h2 className="ui-h2">Новый личный кабинет</h2>
      <form onSubmit={submit} className="mt-5 grid gap-3 sm:grid-cols-2">
        <Field label="Имя и фамилия">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Имя Фамилия"
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
        <Field label="Компания">
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Название компании"
            className={inputCls}
          />
        </Field>
        <Field label="Роль">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className={inputCls}
          >
            <option value="client">Заказчик</option>
            <option value="project">Проджект-менеджер</option>
            <option value="admin">Администратор</option>
          </select>
        </Field>
        <Field label="Почта">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            inputMode="email"
            placeholder="name@company.ru"
            className={inputCls}
          />
        </Field>
        <Field label="Телеграм">
          <input
            value={telegram}
            onChange={(e) => setTelegram(e.target.value)}
            placeholder="@nickname"
            className={inputCls}
          />
        </Field>
        <div className="sm:col-span-2">
          <button type="submit" disabled={busy} className="btn btn-primary disabled:opacity-50">
            {busy ? "Заводим" : "Завести кабинет"}
          </button>
        </div>
      </form>

      {issued ? (
        <div className="mt-5 border-t border-[color:var(--color-line)] pt-4">
          <div className="label-caps">Код для {issued.name} — передайте лично</div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="t-h2 tabular-nums">{issued.code}</span>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(issued.code).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
              }}
              className="btn btn-glass"
            >
              {copied ? "Скопировано" : "Скопировать"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function PersonCard({
  person: p,
  open,
  onToggle,
}: {
  person: Participant;
  open: boolean;
  onToggle: () => void;
}) {
  const { setActive, remove, update } = useDirectory();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [edit, setEdit] = useState(false);

  return (
    <div className="card-flat px-5 py-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={`ui-title ${p.active ? "" : "text-muted-foreground line-through"}`}>
              {p.name}
            </span>
            <span className="label-caps rounded-[var(--radius-pill)] border border-[color:var(--color-line)] px-2 py-[2px]">
              {roleLabel[p.role]}
            </span>
            {!p.active ? (
              <span className="ui-meta text-[color:var(--color-accent)]">код отозван</span>
            ) : null}
          </div>
        </div>

        <div className="min-w-0">
          <CodeCell code={p.code} name={p.name} />
          <div className="ui-meta mt-1 text-muted-foreground">
            {p.lastUsedAt ? `заходил ${p.lastUsedAt}` : "ни разу не заходил"}
          </div>
        </div>

        <button onClick={onToggle} aria-expanded={open} className="btn btn-glass gap-1.5">
          {open ? "Свернуть" : `Агенты · ${p.agentIds.length}`}
          <Chevron />
        </button>
      </div>

      <Reveal open={open} className="mt-5 space-y-5 border-t border-[color:var(--color-line)] pt-5">
        <div>
          <div className="label-caps mb-2.5">Какие агенты открыты</div>
          <AgentAccess person={p} />
        </div>

        {p.role === "client" ? (
          <div>
            <div className="label-caps mb-2.5">Разговоры</div>
            <Conversations personId={p.id} personName={p.name} />
          </div>
        ) : null}

        {edit ? <EditFields person={p} onDone={() => setEdit(false)} onSave={update} /> : null}

        {/*
          Три действия разного веса стоят порознь, а не в одну строку: правка
          ничего не ломает, отзыв кода закрывает вход, удаление стирает работу
          человека. В одной строке они читаются как равные — и рука промахивается.
        */}
        <div className="space-y-4 border-t border-[color:var(--color-line)] pt-4">
          <button onClick={() => setEdit((v) => !v)} className="btn btn-ghost">
            {edit ? "Закрыть правку" : "Изменить данные"}
          </button>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <button onClick={() => setActive(p.id, !p.active)} className="btn btn-ghost">
              {p.active ? "Отозвать код" : "Вернуть доступ"}
            </button>
          </div>

          {/* Подтверждение встаёт на место самой кнопки: ничего не прыгает и не
              оказывается под пальцем там, где только что было другое действие. */}
          <div className="border-t border-[color:var(--color-line)] pt-4">
            {confirmDelete ? (
              <div className="space-y-2.5">
                <p className="ui-support measure text-muted-foreground">
                  Удалить кабинет «{p.name}» со всеми задачами?
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => remove(p.id)}
                    className="btn btn-ghost text-[color:var(--color-error)]"
                  >
                    Удалить кабинет и всё в нём
                  </button>
                  <button onClick={() => setConfirmDelete(false)} className="btn btn-ghost">
                    Отмена
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="btn btn-ghost">
                Удалить кабинет
              </button>
            )}
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/** Правка данных участника. Код не меняется: он уже у человека на руках. */
function EditFields({
  person: p,
  onDone,
  onSave,
}: {
  person: Participant;
  onDone: () => void;
  onSave: (id: string, patch: Partial<Omit<Participant, "id" | "code">>) => void;
}) {
  const [draft, setDraft] = useState({
    name: p.name,
    position: p.position,
    company: p.company,
    email: p.email,
    telegram: p.telegram,
    role: p.role,
    leads: Boolean(p.leads),
    hidden: Boolean(p.hidden),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave(p.id, { ...draft, telegram: cleanTelegram(draft.telegram) });
        onDone();
      }}
      className="grid gap-3 sm:grid-cols-2"
    >
      <Field label="Имя и фамилия">
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className={inputCls}
        />
      </Field>
      <Field label="Должность">
        <input
          value={draft.position}
          onChange={(e) => setDraft({ ...draft, position: e.target.value })}
          className={inputCls}
        />
      </Field>
      <Field label="Компания">
        <input
          value={draft.company}
          onChange={(e) => setDraft({ ...draft, company: e.target.value })}
          className={inputCls}
        />
      </Field>
      <Field label="Роль">
        <select
          value={draft.role}
          onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}
          className={inputCls}
        >
          <option value="client">Заказчик</option>
          <option value="project">Проджект-менеджер</option>
          <option value="admin">Администратор</option>
        </select>
      </Field>
      <Field label="Почта">
        <input
          value={draft.email}
          onChange={(e) => setDraft({ ...draft, email: e.target.value })}
          className={inputCls}
        />
      </Field>
      <Field label="Телеграм">
        <input
          value={draft.telegram}
          onChange={(e) => setDraft({ ...draft, telegram: e.target.value })}
          className={inputCls}
        />
      </Field>
      {/* Два свойства кабинета, а не роли: руководитель ведёт и свою работу,
          а служебный кабинет остаётся обычным — просто не мозолит глаза
          руководителю. */}
      <label className="flex items-start gap-2.5 sm:col-span-2">
        <input
          type="checkbox"
          checked={draft.leads}
          onChange={(e) => setDraft({ ...draft, leads: e.target.checked })}
          className="mt-1 flex-none"
        />
        <span className="ui-body">Руководитель команды</span>
      </label>
      <label className="flex items-start gap-2.5 sm:col-span-2">
        <input
          type="checkbox"
          checked={draft.hidden}
          onChange={(e) => setDraft({ ...draft, hidden: e.target.checked })}
          className="mt-1 flex-none"
        />
        <span className="ui-body">Служебный кабинет</span>
      </label>
      <div className="sm:col-span-2">
        {/* Тёмная заливка на экране одна и она у «Завести кабинет»: правка данных —
            не главное действие раздела, а разовая починка опечатки. */}
        <button type="submit" className="btn btn-glass">
          Сохранить
        </button>
      </div>
    </form>
  );
}

// ── Обзор ─────────────────────────────────────────────────────────────────────
/**
 * Честно показываем только то, что действительно известно: сколько заведено,
 * кому ещё не открыли агентов и кто ни разу не вошёл. Учёт расхода вернётся
 * вместе с настоящим счётчиком, а не раньше.
 */
function Overview() {
  const { participants } = useDirectory();
  const active = participants.filter((p) => p.active);
  const clientsWithoutAgents = active.filter((p) => p.role === "client" && p.agentIds.length === 0);
  const neverEntered = active.filter((p) => !p.lastUsedAt);

  return (
    <div className="space-y-10">
      <section className="grid gap-6 border-y border-[color:var(--color-line)] py-6 sm:grid-cols-3">
        <Stat n={active.length} label="Кабинетов с доступом" />
        <Stat n={active.filter((p) => p.role === "client").length} label="Из них клиентов" />
        <Stat n={agents.length} label="Агентов в каталоге" />
      </section>

      {/* Коды и здесь закрыты: обзор чаще всего и показывают с экрана. */}
      <ListSection
        title="Кабинет есть, агентов нет"
        empty="У всех клиентов открыт хотя бы один агент"
        items={clientsWithoutAgents.map((p) => ({
          id: p.id,
          main: p.name,
          side: maskCode(p.code),
        }))}
      />

      <ListSection
        title="Код выдан, но ни разу не вошли"
        empty="Все, кому выдали код, уже заходили"
        items={neverEntered.map((p) => ({ id: p.id, main: p.name, side: maskCode(p.code) }))}
      />
    </div>
  );
}

function ListSection({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: { id: string; main: string; side: string }[];
}) {
  return (
    <section>
      <h2 className="ui-h2 mb-4">{title}</h2>
      {items.length ? (
        <ul className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-baseline justify-between gap-3 py-3">
              <span className="ui-body">{i.main}</span>
              <span className="ui-meta tracking-[0.06em] text-muted-foreground">{i.side}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ui-support text-muted-foreground">{empty}</p>
      )}
    </section>
  );
}

/** Счётчик читается первым, но остаётся ниже заголовка страницы: это цифра
 *  внутри экрана, а не его название. Отсюда t-h2, а не витринный t-number. */
function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="t-h2 tabular-nums">{n}</div>
      <div className="ui-support mt-1.5 text-muted-foreground">{label}</div>
    </div>
  );
}

// ── Мелочи ────────────────────────────────────────────────────────────────────

/**
 * Код закрыт до нажатия «Показать». Формат оставляем узнаваемым: префикс
 * и, если он есть, хвостовой номер — по ним видно, чей код, но прочитать
 * его с чужого экрана нельзя.
 */
function maskCode(code: string): string {
  if (!code) return "—";
  const parts = code.split("-");
  const head = parts.shift() ?? "";
  if (!parts.length) return "•".repeat(Math.max(5, head.length));
  const tail = /^\d+$/.test(parts.at(-1) ?? "") ? (parts.pop() ?? "") : "";
  const hidden = "•".repeat(Math.max(5, parts.join("-").length));
  return [head, hidden, tail].filter(Boolean).join("-");
}

function CodeCell({ code, name }: { code: string; name: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="ui-meta tracking-[0.06em] text-foreground">
        {shown ? code : maskCode(code)}
      </span>
      <button
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? `Скрыть код: ${name}` : `Показать код: ${name}`}
        className="ui-meta min-h-11 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {shown ? "Скрыть" : "Показать"}
      </button>
      {/* Скопировать можно не показывая: код чаще передают, чем читают вслух. */}
      <button
        onClick={() => {
          navigator.clipboard?.writeText(code).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
        aria-label={`Скопировать код: ${name}`}
        className="ui-meta min-h-11 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        {copied ? "Скопировано" : "Скопировать"}
      </button>
    </div>
  );
}

const inputCls =
  "ui-body mt-1.5 w-full border-0 border-b border-[color:var(--color-line)] bg-transparent px-0 py-2 outline-none transition-colors focus-visible:outline-none focus:border-[color:var(--color-text-primary)]";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label-caps">{label}</span>
      {children}
    </label>
  );
}
