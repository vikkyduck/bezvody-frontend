import { Link } from "@tanstack/react-router";

/**
 * Первый keynote-экран NOWATER.TECH: одно утверждение, один вход.
 *
 * Ревизия 26.08.2026. Правило простое: на экране остаётся только то, что
 * человек обязан прочитать. Всё, что осталось, выровнено по одной колонке
 * и по одной вертикальной сетке — шапка, заголовок, подпись и нижние метки
 * начинаются от общего левого поля, поэтому экран читается как один лист,
 * а не как четыре независимых блока.
 */

/** Нижняя метка: одна строка факта под служебным словом. */
function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[color:var(--color-text-muted)]">
        {label}
      </div>
      <div className="mt-2 text-[12px] leading-none">{value}</div>
    </div>
  );
}

export function Landing() {
  return (
    <div className="stage flex min-h-screen flex-col bg-background font-sans">
      {/* Шапка: бренд и единственное действие. Плашку заменила линия —
          заполненный прямоугольник кричал громче заголовка. */}
      <header className="rise flex flex-none items-center justify-between px-6 pt-7 sm:px-10 md:px-[4.1vw] md:pt-10">
        <span className="text-[12px] font-extrabold tracking-[0.02em]">NOWATER.TECH</span>
        <Link to="/vhod" className="action-line">
          Войти
        </Link>
      </header>

      <section className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-6 pb-10 pt-[14vh] sm:px-10 sm:pb-12 md:px-[4.1vw] md:pb-[6.5vh] md:pt-[17vh]">
        <h1 className="rise rise-1 max-w-[1050px] text-[clamp(3rem,7.25vw,7rem)] font-normal leading-[0.94] tracking-[-0.022em]">
          Управленческие
          <br />
          решения
          <br />
          <span className="text-[color:var(--color-text-muted)]">на ИИ-агентах</span>
        </h1>

        <div className="rise rise-2 mt-12 grid gap-10 sm:mt-16 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:gap-16">
          <div>
            <p className="max-w-[42ch] text-base leading-[1.6] text-[color:var(--color-text-secondary)] sm:text-lg">
              Агенты собирают данные, проверяют источники и спорят с выводами, готовя документ к
              защите.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <span className="h-px w-10 bg-foreground" />
              <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[color:var(--color-text-muted)]">
                Первая выдача на 5-й день
              </span>
            </div>
          </div>
          {/* Цифра выровнена по базовой линии абзаца справа: это не плитка,
              а вторая строчка того же утверждения. */}
          <div className="md:min-w-44 md:text-right">
            <div
              className="text-[clamp(2.4rem,3.6vw,3.6rem)] font-normal leading-[0.9] tracking-[-0.03em]"
              data-numeric
            >
              0%
            </div>
            <div className="mt-3 text-[9px] font-semibold uppercase tracking-[0.2em] text-[color:var(--color-text-muted)]">
              Воды в отчётах
            </div>
          </div>
        </div>

        {/* Служебные факты — у самого низа листа, на общей линии. */}
        <div className="rise rise-3 mt-auto border-t border-[color:var(--color-line)] pt-6">
          <div className="flex flex-wrap gap-x-16 gap-y-6">
            <Meta label="Доступ" value="Браузер / без VPN" />
            <Meta label="Хранение" value="Россия, 152-ФЗ" />
          </div>
        </div>
      </section>
    </div>
  );
}
