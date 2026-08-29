import { useState } from "react";

import { Attachments } from "@/components/Attachments";
import { Markdown } from "@/components/Markdown";
import { agentById } from "@/lib/shtab-data";
import type { StoredWindow } from "@/lib/conversations";
import { MAX_WINDOW_FILES } from "@/lib/documents";
import type { StoredProject } from "@/lib/projects";
import { DOCX_MIME, saveFile } from "@/lib/download";
import { downloadAnswerServer, downloadFileServer } from "@/lib/server-files";
import { readWindowsServer } from "@/lib/server-windows";
import { useSession } from "@/lib/session";

/**
 * Чужая переписка глазами администратора — только чтение и только по запросу.
 * Вместе с репликами видно и документы, которые клиент принёс в разговор: без
 * них половина разговора непонятна, а скачать их иногда нужно, чтобы разобраться.
 *
 * Раздел свёрнут и ничего не грузит, пока его не откроют: в списке участников
 * это одна строка, а не стена текста. Отвечать за клиента отсюда нельзя —
 * это его работа, а не ваша.
 */
export function Conversations({ personId, personName }: { personId: string; personName: string }) {
  const { code } = useSession();
  const [state, setState] = useState<"closed" | "loading" | "open">("closed");
  const [windows, setWindows] = useState<StoredWindow[]>([]);
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  /** Что видел агент в этом разговоре: документы задачи плюс принесённое сюда. */
  const docsOf = (w: StoredWindow) => [
    ...(projects.find((p) => p.id === w.projectId)?.files ?? []),
    ...w.files,
  ];

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
      setProjects(res.projects);
      setState("open");
    } catch {
      setState("closed");
    }
  }

  return (
    <div>
      <button onClick={toggle} className="btn btn-ghost ui-meta">
        {state === "open"
          ? "Скрыть переписку"
          : state === "loading"
            ? "Открываю"
            : "Посмотреть переписку"}
      </button>

      {state === "open" ? (
        windows.length ? (
          <div className="mt-3 space-y-2">
            {windows.map((w) => {
              const agent = agentById(w.agentId);
              const shown = openId === w.id;
              return (
                <div
                  key={w.id}
                  className="rounded-[12px] border border-[color:var(--color-line)] px-4 py-3"
                >
                  <button
                    onClick={() => setOpenId(shown ? null : w.id)}
                    className="flex w-full flex-wrap items-baseline justify-between gap-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="ui-title block">{w.title}</span>
                      <span className="ui-meta mt-0.5 block">
                        {agent?.name ?? "агент недоступен"} · сообщений {w.messages.length}
                        {projects.find((p) => p.id === w.projectId)?.title
                          ? ` · задача «${projects.find((p) => p.id === w.projectId)?.title}»`
                          : ""}
                      </span>
                    </span>
                    <span className="ui-meta flex-none">{shown ? "свернуть" : "открыть"}</span>
                  </button>

                  {/* Чужой разбор — тоже шесть страниц: читаем его в отдельной
                      прокрутке, иначе одна раскрытая переписка растягивает
                      админку на десятки тысяч пикселей. */}
                  {shown ? (
                    <div className="mt-3 max-h-[520px] space-y-2.5 overflow-y-auto border-t border-[color:var(--color-line)] pt-3">
                      {docsOf(w).length ? (
                        <div className="pb-1">
                          <div className="label-caps mb-1.5">Документы задачи и разговора</div>
                          <Attachments
                            files={docsOf(w)}
                            max={MAX_WINDOW_FILES}
                            onDownload={(f) =>
                              code
                                ? downloadFileServer({
                                    data: {
                                      code,
                                      scope: "window",
                                      ownerId: personId,
                                      fileId: f.id,
                                    },
                                  })
                                : Promise.resolve({ ok: false, name: "", mime: "", base64: "" })
                            }
                          />
                        </div>
                      ) : null}

                      {w.messages.length ? (
                        w.messages.map((m) => (
                          // Реплики набраны наборным кеглем: это переписка,
                          // которую администратор читает глазами целиком,
                          // а не подпись под карточкой.
                          <div key={m.id} className="ui-body">
                            {/* Реплику читают глазами сверху вниз — имя отдельной строкой */}
                            <div className="label-caps">
                              {m.from === "user" ? personName : (agent?.name ?? "Агент")}
                            </div>
                            {m.from === "user" ? (
                              <p className="mt-0.5 whitespace-pre-line">{m.text}</p>
                            ) : (
                              <div className="mt-0.5">
                                <Markdown>{m.text}</Markdown>
                                <button
                                  onClick={() => {
                                    if (!code) return;
                                    void downloadAnswerServer({
                                      data: { code, windowId: w.id, messageId: m.id, personId },
                                    }).then((r) => {
                                      if (r.ok) saveFile(r.name, r.base64, DOCX_MIME);
                                    });
                                  }}
                                  className="btn btn-glass ui-meta mt-2"
                                >
                                  Скачать в Word
                                </button>
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <p className="ui-support">Разговор открыли, но не написали ни слова</p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="ui-support mt-3">Разговоров пока нет</p>
        )
      ) : null}
    </div>
  );
}
