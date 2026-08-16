import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, PageHead } from "@/components/AppShell";
import { RunPanel } from "@/components/RunPanel";
import { DecisionCard, EmptyState } from "@/components/DecisionCard";
import { agents, attentionSaved, briefs, dataContour, decisionLog, team } from "@/lib/shtab-data";
import { useShtab } from "@/lib/shtab-store";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Штаб — кабинет команды с ИИ-агентами для решений" },
      {
        name: "description",
        content:
          "Личный кабинет команды: купленные ИИ-агенты готовят управленческие решения — что изменилось, почему, какие варианты. Решение принимает руководитель.",
      },
      { property: "og:title", content: "Штаб — кабинет команды с ИИ-агентами для решений" },
      {
        property: "og:description",
        content: "Агенты собирают данные, находят причины и готовят документ к защите. Выбор остаётся за руководителем.",
      },
    ],
  }),
  component: Cabinet,
});

function Cabinet() {
  const { installed, decided, startRun } = useShtab();
  const mine = agents.filter((a) => installed.includes(a.id));
  const pending = briefs.filter((b) => b.status === "Требует решения" && !decided.includes(b.id));
  const first = pending[0];
  const prepared = briefs.length + 5; // подготовлено агентами за месяц, включая архив
  const saved = attentionSaved(prepared);


  const wordForm = (n: number) => (n === 1 ? "решение ждёт" : n < 5 ? "решения ждут" : "решений ждут");

  return (
    <AppShell>
      <PageHead
        eyebrow="Кабинет команды"
        title={
          pending.length
            ? `${pending.length} ${wordForm(pending.length)} вашей подписи`
            : "Все решения приняты"
        }
        lead={`${team.name} · владелец ${team.owner}`}
        right={
          first ? (
            <Link
              to="/briefs/$briefId"
              params={{ briefId: first.id }}
              className="btn btn-primary text-[13px]"
            >
              Открыть решение
            </Link>
          ) : (
            <Link to="/agents" className="btn btn-glass text-[13px]">
              Каталог агентов
            </Link>
          )
        }
      />

      {/* Один герой-показатель: то, что мы на самом деле продаём — сбережённое внимание */}
      <section className="border-y border-[color:var(--color-line)] py-6">
        <div className="label-caps">Сбережено вашего внимания за месяц</div>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="t-number text-[44px] leading-none tabular-nums sm:text-[56px]">
            {saved.weeks.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}
          </span>
          <span className="text-[15px] text-muted-foreground">
            {weekWord(saved.weeks)} рабочего времени · {saved.hours} часов подготовки
          </span>
        </div>
        <p className="measure mt-3 text-[12.5px] text-muted-foreground">
          Подготовлено {prepared} {declension(prepared, "решение", "решения", "решений")} · принято {decisionLog.length} ·
          агентов работает {mine.length} из {agents.length}. Внимание тратится один раз — на само решение.
        </p>
      </section>


      <section className="mt-10">
        <div className="mb-3 flex items-end justify-between gap-4">
          <h2 className="text-[15px] font-semibold">Ждут вашего решения</h2>
          <Link to="/briefs" className="btn btn-ghost text-[12.5px]">
            Все решения
          </Link>
        </div>

        {pending.length ? (
          <div className="space-y-2.5">
            {pending.map((b) => (
              <DecisionCard key={b.id} brief={b} agentName={agents.find((a) => a.id === b.agentId)?.name} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Ничего не ждёт вас"
            note="Агенты работают по расписанию. Как только появится вопрос, требующий вашей подписи, он окажется здесь."
            action={
              <Link to="/briefs" className="btn btn-glass text-[12.5px]">
                Посмотреть принятые решения
              </Link>
            }
          />
        )}
      </section>

      <section className="mt-11">
        <div className="mb-3 flex items-end justify-between gap-4">
          <h2 className="text-[15px] font-semibold">Ваши агенты</h2>
          <Link to="/agents" className="btn btn-ghost text-[12.5px]">
            Добавить агента
          </Link>
        </div>
        {mine.length ? (
        <div className="grid items-stretch gap-3 md:grid-cols-2">
          {mine.map((a) => (
            <div key={a.id} className="card-flat flex h-full flex-col px-5 py-4">
              <div className="text-[14.5px] font-semibold leading-snug">{a.name}</div>
              <p className="mt-2 flex-1 text-[13px] text-muted-foreground">{a.result}</p>
              <div className="mt-4 flex items-center justify-between gap-3 border-t border-[color:var(--color-line)] pt-3">
                <span className="text-[11px] text-muted-foreground">{a.cadence}</span>
                <button
                  onClick={() => startRun(a.id)}
                  aria-label={`Подготовить решение: ${a.name}`}
                  className="btn btn-glass text-[12.5px]"
                >
                  Подготовить решение
                </button>
              </div>
            </div>
          ))}
        </div>
        ) : (
          <EmptyState
            title="Пока ни один агент не подключён"
            note="Выберите, что команда хочет понимать лучше — агент начнёт готовить решения по расписанию."
            action={
              <Link to="/agents" className="btn btn-glass text-[12.5px]">
                Каталог агентов
              </Link>
            }
          />
        )}
      </section>

      <section className="mt-11">
        <h2 className="mb-1 text-[15px] font-semibold">Память решений</h2>
        <p className="measure mb-4 text-[12.5px] text-muted-foreground">
          Решение остаётся вместе с основанием, владельцем и датой проверки эффекта. Со временем это становится активом
          компании: видно не только что решили, но и почему.
        </p>
        <ol className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
          {decisionLog.map((d) => (
            <li key={d.date} className="flex flex-col gap-1.5 py-4 sm:flex-row sm:gap-5">
              <span className="t-number w-[92px] flex-none pt-[2px] text-[11px] tabular-nums text-muted-foreground/70">
                {d.date}
              </span>
              <div className="min-w-0">
                <div className="text-[14px] font-medium leading-snug">{d.decision}</div>
                <p className="measure mt-1 text-[12.5px] text-muted-foreground">Основание — {d.basis}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                  <span>владелец — {d.owner}</span>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={`h-[5px] w-[5px] flex-none rounded-full ${
                        d.confirmed ? "bg-[color:var(--color-accent)]" : "bg-[color:var(--color-line)]"
                      }`}
                    />
                    {d.confirmed ? `${d.effect} — подтверждён` : d.effect}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <p className="measure mt-8 text-[11.5px] text-muted-foreground">{dataContour}</p>

      <RunPanel />
    </AppShell>
  );
}

const declension = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
};

const weekWord = (n: number) => (Math.abs(n - 1) < 0.05 ? "недели" : "недель");

