import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Столько же, сколько --duration-slow в стилях, плюс запас на кадр. */
const CLOSE_MS = 460;

/**
 * Плавное раскрытие содержимого карточки.
 *
 * Содержимое монтируется только раскрытым и живёт ещё столько, сколько идёт
 * закрытие: внутри карточек участников лежит переписка, которая при монтаже
 * ходит на сервер. Держать её смонтированной у всех карточек списка — это
 * запрос на каждого человека сразу после открытия раздела.
 *
 * Снимаем содержимое по таймеру, а не по transitionend: в спокойном режиме
 * переходы отключены глобально, событие не приходит вовсе, и содержимое
 * осталось бы висеть в разметке нулевой высоты.
 */
export function Reveal({
  open,
  children,
  className = "",
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [mounted, setMounted] = useState(open);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (open) {
      setMounted(true);
      return;
    }
    timer.current = setTimeout(() => setMounted(false), CLOSE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [open]);

  return (
    <div className="reveal" data-open={open ? "true" : "false"} aria-hidden={!open}>
      <div className="reveal__inner">
        {mounted ? <div className={className}>{children}</div> : null}
      </div>
    </div>
  );
}

/** Уголок у кнопки-переключателя: поворачивается вместе с раскрытием. */
export function Chevron() {
  return <ChevronDown data-chevron aria-hidden size={14} className="flex-none" />;
}
