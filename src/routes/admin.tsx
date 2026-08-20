import { createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";

import { AppShell, PageHead } from "@/components/AppShell";
import { AgentAccess, Contacts } from "@/components/AgentAccess";
import { AgentSetup } from "@/components/AgentSetup";
import { agents } from "@/lib/shtab-data";
import { Conversations } from "@/components/Conversations";
import { Reports } from "@/components/Reports";
import { cleanTelegram, useDirectory, type Participant } from "@/lib/directory";
import { roleLabel, type Role } from "@/lib/platform-data";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Кабинет администратора — платформа «Без Воды»" },
      { name: "description", content: "Участники, доступы и агенты платформы." },
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
      <PageHead
        n="01"
        eyebrow="Кабинет администратора"
        title="Кто работает на платформе"
        lead="Заводите личные кабинеты, открывайте каждому своих агентов и передавайте код из рук в руки."
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
 */
function People() {
  const { participants } = useDirectory();
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-10">
      <NewParticipant onCreated={(p) => setOpenId(p.id)} />

      <section>
        <h2 className="mb-4 text-[15px] font-semibold">
          Личные кабинеты <span className="text-muted-foreground">· {participants.length}</span>
        </h2>
        <div className="space-y-2.5">
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
    <section className="card-flat px-5 py-5">
      <h2 className="text-[15px] font-semibold">Новый личный кабинет</h2>
      <p className="measure mt-1 text-[12.5px] text-muted-foreground">
        Имя обязательно, остальное — по желанию. Контакт нужен вам, чтобы знать, куда передать код:
        платформа сама никому не пишет.
      </p>

      <form onSubmit={submit} className="mt-5 grid gap-3 sm:grid-cols-2">
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
        <Field label="Компания">
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Название компании"
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
          <button type="submit" disabled={busy} className="btn btn-primary text-[13px] disabled:opacity-50">
            {busy ? "Заводим" : "Завести кабинет"}
          </button>
        </div>
      </form>

      {issued ? (
        <div className="mt-5 border-t border-[color:var(--color-line)] pt-4">
          <div className="label-caps">Код для {issued.name} — передайте лично</div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="t-number text-[22px] tracking-[0.08em]">{issued.code}</span>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(issued.code).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
              }}
              className="btn btn-glass text-[12px]"
            >
              {copied ? "Скопировано" : "Скопировать"}
            </button>
          </div>
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            Ниже в карточке откройте этому человеку агентов — без них он войдёт в пустой кабинет.
          </p>
        </div>
      ) : null}
    </section>
  );
}

function PersonCard({ person: p, open, onToggle }: { person: Participant; open: boolean; onToggle: () => void }) {
  const { setActive, remove, update } = useDirectory();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [edit, setEdit] = useState(false);

  return (
    <div className="card-flat px-5 py-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={`text-[15px] font-semibold leading-snug ${p.active ? "" : "text-muted-foreground line-through"}`}>
              {p.name}
            </span>
            <span className="rounded-[var(--radius-pill)] border border-[color:var(--color-line)] px-2 py-[2px] text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {roleLabel[p.role]}
            </span>
            {!p.active ? <span className="text-[11px] text-[color:var(--color-accent)]">код отозван</span> : null}
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {[p.position, p.company].filter(Boolean).join(" · ") || "должность не указана"}
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            <Contacts person={p} />
          </p>
        </div>

        <div className="text-right">
          <div className="t-number text-[13px] tracking-[0.06em]">{p.code}</div>
          <div className="text-[10.5px] text-muted-foreground">
            {p.lastUsedAt ? `заходил ${p.lastUsedAt}` : "ни разу не заходил"}
          </div>
        </div>

        <button onClick={onToggle} className="btn btn-glass text-[12.5px]">
          {open ? "Свернуть" : `Агенты · ${p.agentIds.length}`}
        </button>
      </div>

      {open ? (
        <div className="mt-5 space-y-5 border-t border-[color:var(--color-line)] pt-5">
          <div>
            <div className="label-caps mb-2.5">Какие агенты открыты</div>
            <AgentAccess person={p} />
          </div>

          {p.role === "client" ? (
            <div>
              <div className="label-caps mb-2.5">Переписка</div>
              <Conversations personId={p.id} personName={p.name} />
            </div>
          ) : null}

          {edit ? <EditFields person={p} onDone={() => setEdit(false)} onSave={update} /> : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--color-line)] pt-4">
            <button onClick={() => setEdit((v) => !v)} className="btn btn-ghost text-[12px]">
              {edit ? "Закрыть правку" : "Изменить данные"}
            </button>
            <button onClick={() => setActive(p.id, !p.active)} className="btn btn-ghost text-[12px]">
              {p.active ? "Отозвать код" : "Вернуть доступ"}
            </button>
            {confirmDelete ? (
              <>
                <button
                  onClick={() => remove(p.id)}
                  className="btn btn-ghost text-[12px] text-[color:var(--color-error)]"
                >
                  Точно удалить
                </button>
                <button onClick={() => setConfirmDelete(false)} className="btn btn-ghost text-[12px]">
                  Отмена
                </button>
              </>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="btn btn-ghost text-[12px]">
                Удалить кабинет
              </button>
            )}
            <span className="ml-auto text-[11px] text-muted-foreground">
              Отозванный код перестаёт пускать, но кабинет остаётся в списке. Удаление стирает его совсем.
            </span>
          </div>
        </div>
      ) : null}
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
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputCls} />
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
          <option value="client">Клиент</option>
          <option value="project">Проджект</option>
          <option value="admin">Администратор</option>
        </select>
      </Field>
      <Field label="Почта">
        <input value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className={inputCls} />
      </Field>
      <Field label="Телеграм">
        <input
          value={draft.telegram}
          onChange={(e) => setDraft({ ...draft, telegram: e.target.value })}
          className={inputCls}
        />
      </Field>
      <div className="sm:col-span-2">
        <button type="submit" className="btn btn-primary text-[12.5px]">
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

      <ListSection
        title="Кабинет есть, агентов нет"
        note="Такой человек войдёт и увидит пустое окно. Откройте ему агентов в карточке."
        empty="У всех клиентов открыт хотя бы один агент."
        items={clientsWithoutAgents.map((p) => ({ id: p.id, main: p.name, side: p.code }))}
      />

      <ListSection
        title="Код выдан, но ни разу не вошли"
        note="Либо код не дошёл, либо человек не понял, зачем заходить. И то и другое чинится звонком."
        empty="Все, кому выдали код, уже заходили."
        items={neverEntered.map((p) => ({ id: p.id, main: p.name, side: p.code }))}
      />
    </div>
  );
}

function ListSection({
  title,
  note,
  empty,
  items,
}: {
  title: string;
  note: string;
  empty: string;
  items: { id: string; main: string; side: string }[];
}) {
  return (
    <section>
      <h2 className="mb-1 text-[15px] font-semibold">{title}</h2>
      <p className="measure mb-4 text-[12.5px] text-muted-foreground">{note}</p>
      {items.length ? (
        <ul className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-baseline justify-between gap-3 py-3">
              <span className="text-[14px]">{i.main}</span>
              <span className="t-number text-[12px] tracking-[0.06em] text-muted-foreground">{i.side}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted-foreground">{empty}</p>
      )}
    </section>
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
