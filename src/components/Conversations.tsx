import { useState } from "react";

import { Markdown } from "@/components/Markdown";
import { agentById } from "@/lib/shtab-data";
import type { StoredWindow } from "@/lib/conversations";
import { readWindowsServer } from "@/lib/server-windows";
import { useSession } from "@/lib/session";

/**
 * Чужая переписка глазами администратора — только чтение и только по запросу.
 *
 * Раздел свёрнут и ничего не грузит, пока его не откроют: в списке участников
 * это одна строка, а не стена текста. Отвечать за клиента отсюда нельзя —
 * это его работа, а не ваша.
 */
export function Conversations({ personId, personName }: { personId: string; personName: string }) {
  const { code } = useSession();
  const [state, setState] = useState<"closed" | "loading" | "open">("closed");
  const [windows, setWindows] = useState<StoredWindow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  async function toggle() {
    if (state === "open") {
      setState("closed");
      return;
    }
    if (!code) return;
    setState("loading");
    try {
      const res = await readWindowsServer({ data: { code, personId } });
      setWindows(res.windows);
      setState("open");
    } catch {
      setState("closed");
    }
  }

  return (
    <div>
      <button onClick={toggle} className="btn btn-ghost text-[12px]">
        {state === "open" ? "Скрыть переписку" : state === "loading" ? "Открываю" : "Посмотреть переписку"}
      </button>

      {state === "open" ? (
        windows.length ? (
          <div className="mt-3 space-y-2">
            {windows.map((w) => {
              const agent = agentById(w.agentId);
              const shown = openId === w.id;
              return (
                <div key={w.id} className="rounded-[12px] border border-[color:var(--color-line)] px-4 py-3">
                  <button
                    onClick={() => setOpenId(shown ? null : w.id)}
                    className="flex w-full flex-wrap items-baseline justify-between gap-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block text-[13.5px] font-medium leading-snug">{w.title}</span>
                      <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                        {agent?.name ?? "агент недоступен"} · сообщений {w.messages.length}
                      </span>
                    </span>
                    <span className="flex-none text-[11.5px] text-muted-foreground">
                      {shown ? "свернуть" : "открыть"}
                    </span>
                  </button>

                  {shown ? (
                    <div className="mt-3 space-y-2.5 border-t border-[color:var(--color-line)] pt-3">
                      {w.messages.length ? (
                        w.messages.map((m) => (
                          <div key={m.id} className="text-[12.5px] leading-relaxed">
                            {/* Реплику читают глазами сверху вниз — имя отдельной строкой */}
                            <div className="label-caps">
                              {m.from === "user" ? personName : (agent?.name ?? "Агент")}
                            </div>
                            {m.from === "user" ? (
                              <p className="mt-0.5 whitespace-pre-line">{m.text}</p>
                            ) : (
                              <div className="mt-0.5">
                                <Markdown>{m.text}</Markdown>
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <p className="text-[12.5px] text-muted-foreground">Окно открыли, но не написали ни слова.</p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-[12.5px] text-muted-foreground">Окон пока нет.</p>
        )
      ) : null}
    </div>
  );
}
