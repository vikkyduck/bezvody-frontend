import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AppShell } from "@/components/AppShell";
import { agents, briefs, confidenceLabel, type Brief } from "@/lib/shtab-data";
import { useShtab } from "@/lib/shtab-store";
import { SectionLabel } from "@/components/bv/core";
import { SourceTag } from "@/components/bv/SourceTag";


export const Route = createFileRoute("/briefs/$briefId")({
  head: () => ({
    meta: [
      { title: "Решение на одну страницу — Штаб" },
      {
        name: "description",
        content: "Одна страница решения: вывод, доказательства с источниками, рекомендация агента, альтернативы, владелец и контроль эффекта.",
      },
      { property: "og:title", content: "Решение на одну страницу — Штаб" },
      { property: "og:description", content: "Вывод, доказательства, альтернативы, риски и контроль эффекта на одном экране." },
    ],
  }),
  loader: ({ params }) => {
    const brief = briefs.find((b) => b.id === params.briefId);
    if (!brief) throw notFound();
    return { briefId: brief.id };
  },
  component: BriefPage,
});

const EASE = [0.19, 1, 0.22, 1] as const;

function BriefPage() {
  const { briefId } = Route.useLoaderData();
  const brief = briefs.find((b) => b.id === briefId);
  // Решение могли отозвать, а ссылку сохранить в закладках — падать на этом нельзя.
  if (!brief) return <BriefMissing />;
  return <BriefBody brief={brief} />;
}

function BriefMissing() {
  return (
    <AppShell allow={["client"]}>
      <div className="card-flat px-6 py-12 text-center">
        <h1 className="text-[17px] font-semibold">Решение не найдено</h1>
        <p className="measure mx-auto mt-2.5 text-[13.5px] text-muted-foreground">
          Возможно, оно ещё не готово или ссылка устарела.
        </p>
        <Link to="/briefs" className="btn btn-glass mt-5 text-[12.5px]">
          Все решения
        </Link>
      </div>
    </AppShell>
  );
}

function BriefBody({ brief }: { brief: Brief }) {
  const agent = agents.find((a) => a.id === brief.agentId);
  const { decided, decide, undecide } = useShtab();
  const accepted = decided.includes(brief.id) || brief.status === "Решение принято";

  const [choice, setChoice] = useState(brief.recommend);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const option = brief.options[choice] ?? brief.options[0]!;

  return (
    <AppShell allow={["client"]}>
      <Link to="/briefs" className="btn btn-ghost text-[12.5px]">
        ← Все решения
      </Link>

      {/* Решение = один экран: вопрос, рекомендация, одна кнопка */}
      <div className="mt-5">
        <SectionLabel n="01">Требуется ваше решение</SectionLabel>
        <h1 className="t-h1 mt-3 max-w-[26ch]">{brief.title}</h1>
        <p className="measure mt-3 text-[13.5px] text-muted-foreground">{brief.summary}</p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[11.5px] text-muted-foreground">
          <span>{brief.due}</span>
          <span>{brief.stake}</span>
          <span>{confidenceLabel(brief)}</span>
          <span>{brief.freshness}</span>
        </div>

      </div>

      <section className="mt-7 card-flat p-6">
        <div className="label-caps">
          Рекомендация агента{option.scenario ? ` · сценарий ${option.scenario.toLowerCase()}` : ""}
        </div>
        <h2 className="mt-2 text-[19px] font-semibold leading-snug">{option.name}</h2>

        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="label-caps">Эффект</dt>
            <dd className="mt-1 text-[13.5px]">{option.effect}</dd>
          </div>
          <div>
            <dt className="label-caps">Риск</dt>
            <dd className="mt-1 text-[13.5px] text-muted-foreground">{option.risk}</dd>
          </div>
          <div>
            <dt className="label-caps">Владелец и контроль</dt>
            <dd className="mt-1 text-[13.5px] text-muted-foreground">
              {brief.owner} · {brief.review}
            </dd>
          </div>
        </dl>

        <AnimatePresence initial={false} mode="wait">
          {accepted ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE }}
              className="mt-6 border-t border-[color:var(--color-line)] pt-5"
            >
              <div className="flex items-center gap-2 text-[13.5px] font-medium">
                <span aria-hidden className="h-[6px] w-[6px] rounded-full bg-[color:var(--color-accent)]" />
                Решение зафиксировано
              </div>
              <p className="measure mt-2 text-[13px] text-muted-foreground">
                «{option.name}» · владелец — {brief.owner} · {brief.review}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Link to="/" className="btn btn-glass text-[12.5px]">
                  В журнал решений
                </Link>
                <button onClick={() => undecide(brief.id)} className="btn btn-ghost text-[12.5px]">
                  Отозвать решение
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="act"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: EASE }}
              className="mt-6 flex flex-wrap items-center gap-3 border-t border-[color:var(--color-line)] pt-5"
            >
              <button onClick={() => decide(brief.id)} className="btn btn-primary text-[13px]">
                Согласовать
              </button>
              <button
                onClick={() => setShowAlternatives((v) => !v)}
                aria-expanded={showAlternatives}
                className="btn btn-ghost text-[12.5px]"
              >
                {showAlternatives ? "Скрыть другие варианты" : "Выбрать другой вариант"}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <AnimatePresence initial={false}>
        {showAlternatives && !accepted ? (
          <motion.section
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.45, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="mt-3 grid gap-2.5 md:grid-cols-2">
              {brief.options.map((o, i) => (
                <button
                  key={o.name}
                  onClick={() => {
                    setChoice(i);
                    setShowAlternatives(false);
                  }}
                  aria-pressed={i === choice}
                  className={`card-flat px-5 py-4 text-left transition-transform duration-300 hover:-translate-y-[2px] ${
                    i === choice ? "border-[color:var(--color-accent)]/45" : ""
                  }`}
                >
                  {o.scenario ? <div className="label-caps mb-2">{o.scenario} сценарий</div> : null}
                  <div className="text-[14px] font-medium leading-snug">{o.name}</div>
                  <div className="mt-2 text-[12.5px]">{o.effect}</div>
                  <div className="mt-1 text-[12.5px] text-muted-foreground">{o.risk}</div>
                  {i === brief.recommend ? (
                    <div className="mt-2.5 text-[11px] text-muted-foreground">рекомендация агента</div>
                  ) : null}

                </button>
              ))}
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>

      {/* Доказательства — вторичны: раскрываются по запросу, не занимают экран */}
      <section className="mt-8">
        <button
          onClick={() => setShowEvidence((v) => !v)}
          aria-expanded={showEvidence}
          className="btn btn-ghost text-[12.5px]"
        >
          {showEvidence ? "Скрыть, как это посчитано" : "Показать, как это посчитано"}
        </button>
        <AnimatePresence initial={false}>
          {showEvidence ? (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.45, ease: EASE }}
              className="overflow-hidden"
            >
              <div className="mt-3 space-y-2.5">
                {brief.findings.map((f) => (
                  <div key={f.claim} className="card-flat px-5 py-4">
                    <div className="text-[13.5px] font-medium leading-snug">{f.claim}</div>
                    <div className="mt-1.5 text-[12px] text-muted-foreground">{f.evidence}</div>
                    <div className="mt-1 text-[12px]">{f.delta}</div>
                    <SourceTag source={f.source} />
                  </div>
                ))}
              </div>
              <p className="measure mt-3 text-[11.5px] text-muted-foreground">
                Подготовил: {agent?.name} · {brief.dataQuality}. У каждого утверждения есть первоисточник — любой факт
                можно проверить, не выходя из решения.
              </p>
            </motion.div>

          ) : null}
        </AnimatePresence>
      </section>

      <p className="mt-8 text-[11.5px] text-muted-foreground">
        Агент не принимает решение — он готовит фактуру, сценарии и документ к защите.
      </p>
    </AppShell>
  );
}
