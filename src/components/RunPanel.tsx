import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { agents } from "@/lib/shtab-data";
import { useShtab } from "@/lib/shtab-store";

/**
 * Работу машины делает машина: шаги идут сами, человек может только прервать.
 * По завершении — прямой переход к готовому решению.
 */
export function RunPanel() {
  const { run, nextStep, closeRun } = useShtab();
  const agent = agents.find((a) => a.id === run?.agentId);
  const total = agent?.steps.length ?? 0;
  const done = run?.done ?? false;

  useEffect(() => {
    if (!run || done || !total) return;
    const t = setTimeout(() => nextStep(total), 900);
    return () => clearTimeout(t);
  }, [run, done, total, nextStep]);

  if (!run || !agent) return null;
  const progress = Math.round((Math.min(run.step, total) / total) * 100);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Подготовка решения: ${agent.name}`}
      className="fixed inset-0 z-50 flex items-end justify-center bg-[color:var(--color-bg-primary)]/70 p-4 backdrop-blur-sm sm:items-center"
    >
      <div className="card-flat w-full max-w-[520px] p-6">
        <div className="label-caps">{done ? "Решение готово" : "Агент готовит решение"}</div>
        <h2 className="mt-1.5 text-[17px] font-semibold leading-snug">{agent.name}</h2>

        <div className="mt-4 h-[3px] w-full overflow-hidden rounded-full bg-[color:var(--color-line)]">
          <div
            className="h-full rounded-full bg-[color:var(--color-accent)] transition-[width] duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        <ol className="mt-4 space-y-1">
          {agent.steps.map((s, i) => {
            const state = i < run.step ? "done" : i === run.step ? "current" : "todo";
            return (
              <li
                key={s}
                className={`flex items-center gap-3 py-1.5 text-[13px] transition-colors ${
                  state === "current"
                    ? "text-foreground"
                    : state === "done"
                      ? "text-muted-foreground"
                      : "text-muted-foreground/50"
                }`}
              >
                <span
                  aria-hidden
                  className={`h-[5px] w-[5px] flex-none rounded-full ${
                    state === "current"
                      ? "bg-[color:var(--color-accent)]"
                      : state === "done"
                        ? "bg-[color:var(--color-line)]"
                        : "bg-[color:var(--color-line)]/50"
                  }`}
                />
                <span className="flex-1">{s}</span>
                {state === "done" ? <span className="text-[11px]">готово</span> : null}
              </li>
            );
          })}
        </ol>

        <div className="mt-5 flex items-center gap-3">
          {done ? (
            <>
              <Link to="/briefs" onClick={closeRun} className="btn btn-primary text-[13px]">
                Открыть решение
              </Link>
              <button onClick={closeRun} className="btn btn-ghost text-[12.5px]">
                Позже
              </button>
            </>
          ) : (
            <button onClick={closeRun} className="btn btn-ghost text-[12.5px]">
              Прервать
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
