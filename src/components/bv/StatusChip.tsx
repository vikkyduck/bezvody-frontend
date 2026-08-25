/**
 * Статус — нейтральная плашка. Цветом (акцентом) помечается только точка
 * у статуса, который требует действия человека: акцент = действие.
 */
export function StatusChip({ status }: { status: string }) {
  const needsAction = status === "Требует решения";
  // label-caps вместо 10 px: разрядка делает служебную метку читаемой,
  // а десятого кегля в шкале кабинета нет.
  return (
    <span className="label-caps inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-[color:var(--color-line)] px-2.5 py-[3px]">
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
