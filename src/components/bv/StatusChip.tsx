/**
 * Статус — нейтральная плашка. Цветом (акцентом) помечается только точка
 * у статуса, который требует действия человека: акцент = действие.
 */
export function StatusChip({ status }: { status: string }) {
  const needsAction = status === "Требует решения";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-[color:var(--color-line)] px-2.5 py-[3px] text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
      <span
        aria-hidden
        className={`h-[5px] w-[5px] flex-none rounded-full ${
          needsAction ? "bg-[color:var(--color-accent)]" : "bg-[color:var(--color-line)]"
        }`}
      />
      <span className={needsAction ? "text-foreground" : undefined}>{status}</span>
    </span>
  );
}
