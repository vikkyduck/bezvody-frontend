import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHead } from "@/components/AppShell";
import { redLines } from "@/lib/shtab-data";

export const Route = createFileRoute("/limits")({
  head: () => ({
    meta: [
      { title: "Красные линии платформы — что мы не автоматизируем | Штаб" },
      {
        name: "description",
        content:
          "Границы применимости ИИ-агентов: не автоматизируем само решение, кадровые вердикты, переговоры первых лиц, культуру и этические выборы.",
      },
      { property: "og:title", content: "Красные линии платформы — Штаб" },
      {
        property: "og:description",
        content: "Мы автоматизируем подготовку решения. Не автоматизируем само решение, людей и отношения.",
      },
    ],
  }),
  component: Limits,
});

function Limits() {
  return (
    <AppShell>
      <PageHead
        n="04"
        eyebrow="Границы"
        title="Что мы не отдаём алгоритму"
        lead="Это не список ограничений, а профессиональная позиция: то, что мы автоматизируем, работает."
      />

      <ol className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
        {redLines.map((r, i) => (
          <li key={r.thesis} className="flex gap-5 py-5">
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70 pt-[3px]">
              0{i + 1}
            </span>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold leading-snug">{r.thesis}</div>
              <p className="measure mt-1.5 text-[13px] text-muted-foreground">{r.note}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="measure mt-8 text-[13.5px] text-muted-foreground">
        Мы автоматизируем подготовку решения — сбор данных, анализ, сценарии, документ к защите. Мы не автоматизируем
        само решение, людей и отношения. Поэтому агенты усиливают руководителя, а не изображают его.
      </p>
    </AppShell>
  );
}
