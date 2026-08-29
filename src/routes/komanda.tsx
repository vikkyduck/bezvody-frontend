import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AppShell, PageHead } from "@/components/AppShell";
import { Chevron, Reveal } from "@/components/bv/Reveal";
import { useSession } from "@/lib/session";
import { teamServer, type TeamPerson } from "@/lib/server-team";
import { visaLine, type Visa, type VisaStage } from "@/lib/visa";

/**
 * Панель руководителя.
 *
 * Просьба участников: «зачем мне читать документ, если через систему его не
 * прогоняли». Экран отвечает ровно на это и ни на что больше — здесь нет ни
 * переписки, ни файлов, ни текста разборов. Видно, кто над чем работает и до
 * какой ступени доведена работа.
 */
export const Route = createFileRoute("/komanda")({
  head: () => ({
    meta: [
      { title: "Команда — NOWATER.TECH" },
      {
        name: "description",
        content: "Над чем работает команда и что прошло проверку в NOWATER.TECH.",
      },
      { property: "og:title", content: "Команда — NOWATER.TECH" },
      {
        property: "og:description",
        content: "Над чем работает команда и что прошло проверку в NOWATER.TECH.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Team,
});

function Team() {
  return (
    <AppShell allow={["client", "admin"]}>
      <Body />
    </AppShell>
  );
}

function Body() {
  const { code, person } = useSession();
  const [people, setPeople] = useState<TeamPerson[] | null>(null);
  const [denied, setDenied] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    teamServer({ data: { code } })
      .then((r) => {
        if (!alive) return;
        if (!r.ok) setDenied(true);
        else setPeople(r.people);
      })
      .catch(() => alive && setDenied(true));
    return () => {
      alive = false;
    };
  }, [code]);

  // Панель открыта не всем клиентам, а только тем, кому её включили.
  if (denied || (person && person.role === "client" && !person.leads)) {
    return (
      <div className="card-plain mx-auto mt-10 max-w-[520px] px-6 py-8 text-center">
        <h1 className="ui-h2">Этот раздел вам не открыт</h1>
      </div>
    );
  }

  const working = people?.filter((p) => p.tasks.some((t) => !t.closed)) ?? [];
  const idle = people?.filter((p) => !p.tasks.some((t) => !t.closed)) ?? [];

  return (
    <>
      <PageHead eyebrow="Кабинет руководителя" title="Кто над чем работает" />

      {!people ? (
        <p className="ui-body text-muted-foreground">Загружаю…</p>
      ) : (
        <>
          <section className="stagger space-y-3">
            {working.map((p) => (
              <PersonRow
                key={p.id}
                person={p}
                open={openId === p.id}
                onToggle={() => setOpenId(openId === p.id ? null : p.id)}
              />
            ))}
          </section>

          {idle.length ? (
            <section className="mt-11">
              <h2 className="ui-h2 mb-4">Ещё не начинали</h2>
              <ul className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
                {idle.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-baseline justify-between gap-3 py-3"
                  >
                    <span className="ui-body">{p.name}</span>
                    <span className="ui-meta text-muted-foreground">
                      {p.lastUsedAt ? `заходил ${p.lastUsedAt}` : "ни разу не заходил"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {!working.length && !idle.length ? (
            <p className="ui-body text-muted-foreground">Кабинеты команды ещё не завели</p>
          ) : null}
        </>
      )}
    </>
  );
}

function PersonRow({
  person: p,
  open,
  onToggle,
}: {
  person: TeamPerson;
  open: boolean;
  onToggle: () => void;
}) {
  // Закончённые считаем и показываем отдельно: иначе через полгода работы
  // сводка «задач 30 · прогнано 24» ничего не говорит о том, что идёт сейчас.
  const live = p.tasks.filter((t) => !t.closed);
  const closed = p.tasks.filter((t) => t.closed);
  const done = live.filter((t) => t.visa.stage === "прогнано и доработано").length;
  const run = live.filter((t) => t.visa.stage === "прогнано").length;

  return (
    <div className="card-plain px-5 py-5">
      <div className="flex flex-wrap items-start gap-4">
        {/* Кнопка справа не должна сплющивать имя и строку состояния:
            ниже 15rem ряд переносится, а не сжимается. */}
        <div className="min-w-[min(15rem,100%)] flex-1">
          <div className="ui-title leading-snug">{p.name}</div>
          <p className="ui-meta mt-1 text-muted-foreground">
            {`в работе ${live.length}`}
            {run + done ? ` · прогнано ${run + done}` : " · ни одной не прогнали"}
            {done ? ` · из них доработано ${done}` : ""}
            {closed.length ? ` · закончено ${closed.length}` : ""}
          </p>
        </div>

        <button onClick={onToggle} aria-expanded={open} className="btn btn-glass ui-meta gap-1.5">
          {open ? "Свернуть" : "Задачи"}
          <Chevron />
        </button>
      </div>

      <Reveal open={open} className="mt-5 border-t border-[color:var(--color-line)] pt-5">
        <ul className="space-y-4">
          {live.map((t) => (
            <li key={t.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="ui-body font-medium">{t.title}</span>
                <StageChip stage={t.visa.stage} />
              </div>
              <p className="ui-support mt-1 text-muted-foreground">{visaLine(t.visa)}</p>
              <p className="ui-meta mt-0.5 text-muted-foreground">{counts(t.visa)}</p>
            </li>
          ))}
        </ul>

        {closed.length ? (
          <details className="mt-5">
            <summary className="ui-support cursor-pointer text-muted-foreground">
              Законченные · {closed.length}
            </summary>
            <ul className="mt-2 space-y-2">
              {closed.map((t) => (
                <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="ui-body text-muted-foreground">{t.title}</span>
                  <span className="ui-meta text-muted-foreground">{t.visa.stage}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Reveal>
    </div>
  );
}

/** Ступень — цветом только там, где она значит «работа доведена». */
function StageChip({ stage }: { stage: VisaStage }) {
  const strong = stage === "прогнано и доработано";
  return (
    <span
      className={`label-caps flex-none rounded-[var(--radius-pill)] border px-2.5 py-[3px] ${
        strong
          ? "border-[color:var(--color-success)] text-[color:var(--color-success)]"
          : "border-[color:var(--color-line)]"
      }`}
    >
      {stage}
    </span>
  );
}

function counts(v: Visa): string {
  // Руководителю важно состояние дела, а не опись хранилища.
  const bits: string[] = [];
  if (v.returned) bits.push(`незакрытых возражений ${v.returned}`);
  else if (v.documents) bits.push("документ собран");
  else bits.push("документа пока нет");
  if (v.lastAt) bits.push(`последнее движение ${when(v.lastAt)}`);
  return bits.join(" · ");
}

/** Дата человеческим языком: сегодня, вчера или число. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  return d.toLocaleDateString("ru-RU");
}
