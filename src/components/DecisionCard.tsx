import { Link } from "@tanstack/react-router";
import { StatusChip } from "@/components/bv/StatusChip";
import { confidenceLabel, type Brief } from "@/lib/shtab-data";

/**
 * Карточка решения отвечает на «почему я?»: срок, цена вопроса, владелец —
 * три факта в одну строку. Вся карточка — одно действие.
 */
export function DecisionCard({ brief, agentName }: { brief: Brief; agentName?: string | undefined }) {
  return (
    <Link
      to="/briefs/$briefId"
      params={{ briefId: brief.id }}
      aria-label={`Открыть решение: ${brief.title}`}
      className="card-flat group block px-5 py-4 transition-transform duration-300 hover:-translate-y-[3px]"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        <StatusChip status={brief.status} />
        <span className="text-[11.5px] text-muted-foreground">{brief.due}</span>
      </div>

      <div className="mt-2.5 flex items-start justify-between gap-4">
        <div>
          <div className="text-[16px] font-semibold leading-snug">{brief.title}</div>
          <p className="measure mt-1.5 text-[13px] text-muted-foreground">{brief.summary}</p>
        </div>
        <span
          aria-hidden
          className="mt-1 flex-none text-[15px] text-muted-foreground transition-transform duration-300 group-hover:translate-x-1 group-hover:text-foreground"
        >
          →
        </span>
      </div>

      <dl className="mt-3.5 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-[color:var(--color-line)] pt-3 text-[11.5px] text-muted-foreground">
        <div>
          <dt className="sr-only">Цена вопроса</dt>
          <dd>{brief.stake}</dd>
        </div>
        <div>
          <dt className="sr-only">Владелец</dt>
          <dd>владелец — {brief.owner}</dd>
        </div>
        <div>
          <dt className="sr-only">Уверенность</dt>
          <dd>{confidenceLabel(brief)}</dd>
        </div>
        {agentName ? (
          <div className="hidden lg:block">
            <dt className="sr-only">Подготовил</dt>
            <dd>подготовил: {agentName}</dd>
          </div>
        ) : null}
      </dl>
    </Link>
  );
}

/** Спокойное пустое состояние: не ошибка, а хорошая новость. */
export function EmptyState({ title, note, action }: { title: string; note: string; action?: React.ReactNode | undefined }) {
  return (
    <div className="card-flat flex flex-col items-start gap-3 px-6 py-10">
      <div className="text-[15px] font-semibold">{title}</div>
      <p className="measure text-[13px] text-muted-foreground">{note}</p>
      {action}
    </div>
  );
}
