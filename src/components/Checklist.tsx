import { useEffect, useMemo, useState } from "react";

import { getChecklistServer } from "@/lib/server-checklist";
import type { ChecklistSection } from "@/lib/sixpager";
import { useSession } from "@/lib/session";

/**
 * Шпаргалка по 6-pager рядом с разговором.
 *
 * Человек видит те же разделы и вопросы, по которым работает агент: что
 * спросят, что уже закрыто, чего не хватает. Отметки живут в браузере —
 * это личная рабочая пометка, а не документ, и на сервере ей делать нечего.
 *
 * Свёрнута по умолчанию: окно разговора — главное на экране, шпаргалка
 * открывается, когда человек сам к ней потянулся.
 */

const KEY = "bv-6pager-done";

type Done = Record<string, true>;

/** Раздел один раз загрузили — держим в памяти вкладки, чтобы не ходить снова. */
let cache: ChecklistSection[] | null = null;

export function Checklist() {
  const { code } = useSession();
  const [sections, setSections] = useState<ChecklistSection[]>(cache ?? []);
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [done, setDone] = useState<Done>({});

  useEffect(() => {
    try {
      setDone(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Done);
    } catch {
      /* приватный режим браузера — работаем без отметок */
    }
  }, []);

  useEffect(() => {
    if (!code || cache) return;
    getChecklistServer({ data: { code } })
      .then((r) => {
        cache = r.sections;
        setSections(r.sections);
      })
      .catch(() => {
        /* молча: шпаргалка — подсказка, без неё окно работает */
      });
  }, [code]);

  const total = useMemo(() => sections.reduce((n, s) => n + s.questions.length, 0), [sections]);
  const closed = useMemo(
    () =>
      sections.reduce(
        (n, s) => n + s.questions.filter((_, i) => done[`${s.id}:${i}`]).length,
        0,
      ),
    [sections, done],
  );

  function mark(key: string) {
    setDone((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* см. выше */
      }
      return next;
    });
  }

  function setAll(value: boolean) {
    const next: Record<string, boolean> = {};
    for (const s of sections) next[s.id] = value;
    setOpen(next);
  }

  function reset() {
    setDone({});
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* см. выше */
    }
  }

  if (!sections.length) return null;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Шпаргалка: структура 6-pager</h2>
        <button onClick={() => setShown((v) => !v)} className="btn btn-glass text-[12px]">
          {shown ? "Свернуть" : `Открыть · ${total} вопросов`}
        </button>
      </div>
      <p className="measure mt-1 text-[12.5px] text-muted-foreground">
        Те же разделы и вопросы, по которым работает Никита. Отмечайте закрытое — видно, чего
        документу ещё не хватает. Отметки остаются в этом браузере.
      </p>

      {shown ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="t-number text-[13px] tabular-nums">
              {closed} / {total}
            </span>
            <div
              className="h-[3px] min-w-[120px] flex-1 overflow-hidden rounded-full bg-[color:var(--color-line)]"
              role="progressbar"
              aria-valuenow={closed}
              aria-valuemin={0}
              aria-valuemax={total}
            >
              <div
                className="h-full rounded-full bg-[color:var(--color-text-primary)] transition-[width] duration-300"
                style={{ width: total ? `${Math.round((closed / total) * 100)}%` : "0%" }}
              />
            </div>
            <button onClick={() => setAll(true)} className="btn btn-ghost text-[12px]">
              Развернуть всё
            </button>
            <button onClick={() => setAll(false)} className="btn btn-ghost text-[12px]">
              Свернуть всё
            </button>
            {closed ? (
              <button onClick={reset} className="btn btn-ghost text-[12px] text-muted-foreground">
                Снять отметки
              </button>
            ) : null}
          </div>

          <div className="mt-4 space-y-2.5">
            {sections.map((s) => {
              const isOpen = open[s.id] ?? false;
              const sectionDone = s.questions.filter((_, i) => done[`${s.id}:${i}`]).length;
              return (
                <div key={s.id} className="card-flat px-5 py-4">
                  <button
                    onClick={() => setOpen((o) => ({ ...o, [s.id]: !isOpen }))}
                    className="flex w-full items-start gap-3 text-left"
                  >
                    <span className="t-number mt-[3px] flex-none text-[12px] text-muted-foreground">
                      {s.num}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-semibold leading-snug">
                        {s.title}
                      </span>
                      <span className="mt-1 block text-[11.5px] uppercase tracking-[0.12em] text-muted-foreground">
                        {s.questions.length} вопрос{ending(s.questions.length)} · закрыто {sectionDone}
                      </span>
                    </span>
                    <span className="flex-none text-[13px] text-muted-foreground">
                      {isOpen ? "−" : "+"}
                    </span>
                  </button>

                  {isOpen ? (
                    <div className="mt-4 border-t border-[color:var(--color-line)] pt-4">
                      <p className="measure text-[13px] font-medium">{s.note}</p>
                      {s.lead ? (
                        <p className="measure mt-1.5 text-[12.5px] text-muted-foreground">{s.lead}</p>
                      ) : null}

                      <ol className="mt-3">
                        {s.questions.map((q, i) => {
                          const key = `${s.id}:${i}`;
                          const isDone = Boolean(done[key]);
                          return (
                            <li key={key}>
                              <button
                                onClick={() => mark(key)}
                                className="flex w-full items-start gap-3 border-t border-[color:var(--color-line)] py-2.5 text-left"
                              >
                                <span
                                  aria-hidden
                                  className={`mt-[2px] flex h-[17px] w-[17px] flex-none items-center justify-center rounded-[5px] border text-[10px] font-bold ${
                                    isDone
                                      ? "border-[color:var(--color-text-primary)] bg-[color:var(--color-text-primary)] text-[color:var(--color-bg-primary)]"
                                      : "border-[color:var(--color-line)]"
                                  }`}
                                >
                                  {isDone ? "✓" : ""}
                                </span>
                                <span className="t-number flex-none text-[11.5px] text-muted-foreground">
                                  {i + 1}.
                                </span>
                                <span
                                  className={`flex-1 text-[13.5px] leading-relaxed ${
                                    isDone ? "text-muted-foreground line-through decoration-1" : ""
                                  }`}
                                >
                                  {q}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ol>

                      <div className="mt-4 rounded-[12px] border border-[color:var(--color-line)] px-4 py-3">
                        <div className="label-caps">Что должно получиться</div>
                        <p className="measure mt-1.5 text-[13px]">{s.result}</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}

/** «1 вопрос», «2 вопроса», «7 вопросов» — иначе счётчик режет глаз. */
function ending(n: number): string {
  const last = n % 10;
  const two = n % 100;
  if (two >= 11 && two <= 14) return "ов";
  if (last === 1) return "";
  if (last >= 2 && last <= 4) return "а";
  return "ов";
}
