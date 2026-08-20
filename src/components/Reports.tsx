import { useEffect, useMemo, useState } from "react";

import { Markdown } from "@/components/Markdown";
import { DOCX_MIME, saveFile } from "@/lib/download";
import { downloadAnswerServer } from "@/lib/server-files";
import { listReportsServer, readReportServer, type ReportRow } from "@/lib/server-reports";
import { useSession } from "@/lib/session";
import { agentById } from "@/lib/shtab-data";

/**
 * Что клиенты получают на руки — одним списком.
 *
 * Свежее сверху: администратора интересует, что происходит сейчас. Текст
 * разбора грузится только когда его открывают: иначе список из полусотни
 * шестистраничников весит мегабайты и открывается секундами.
 */
export function Reports() {
  const { code } = useSession();
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  useEffect(() => {
    if (!code) return;
    listReportsServer({ data: { code } })
      .then((r) => setRows(r.reports))
      .catch(() => setRows([]));
  }, [code]);

  const shown = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.personName, r.company, r.windowTitle, agentById(r.agentId)?.name ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query]);

  async function open(r: ReportRow) {
    const key = r.messageId;
    if (openId === key) {
      setOpenId(null);
      return;
    }
    setOpenId(key);
    if (text[key]) return;
    const res = await readReportServer({
      data: { code: code ?? "", personId: r.personId, windowId: r.windowId, messageId: r.messageId },
    });
    setText((t) => ({ ...t, [key]: res.text }));
  }

  async function save(r: ReportRow) {
    if (!code) return;
    setBusy(r.messageId);
    try {
      const res = await downloadAnswerServer({
        data: { code, windowId: r.windowId, messageId: r.messageId, personId: r.personId },
      });
      if (res.ok) saveFile(res.name, res.base64, DOCX_MIME);
    } finally {
      setBusy("");
    }
  }

  if (!rows) return <p className="text-[13px] text-muted-foreground">Загружаю…</p>;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-1 text-[15px] font-semibold">
          Что получили клиенты <span className="text-muted-foreground">· {rows.length}</span>
        </h2>
        <p className="measure mb-4 text-[12.5px] text-muted-foreground">
          Каждый разбор, который агент собрал и отдал человеку. Открыть — прочитать целиком,
          скачать — получить тот же файл Word, что и у клиента.
        </p>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Имя, компания или вопрос"
          className="w-full max-w-[420px] rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3 py-2 text-[13px] outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40"
        />
      </section>

      {shown.length ? (
        <ul className="space-y-2.5">
          {shown.map((r) => {
            const opened = openId === r.messageId;
            return (
              <li key={r.messageId} className="card-flat px-5 py-4">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="text-[14.5px] font-semibold leading-snug">{r.personName}</span>
                      {r.company ? <span className="text-[12px] text-muted-foreground">{r.company}</span> : null}
                      <span className="rounded-[var(--radius-pill)] border border-[color:var(--color-line)] px-2 py-[2px] text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        {agentById(r.agentId)?.name ?? r.agentId}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] leading-snug">{r.windowTitle}</p>
                    <p className="measure mt-1 text-[12px] text-muted-foreground">{r.preview}…</p>
                  </div>

                  <div className="flex flex-none flex-col items-end gap-2">
                    <span className="text-[11.5px] text-muted-foreground">
                      {when(r.at)} · {r.chars.toLocaleString("ru-RU")} знаков
                    </span>
                    <span className="flex gap-2">
                      <button onClick={() => void open(r)} className="btn btn-ghost text-[12px]">
                        {opened ? "Свернуть" : "Прочитать"}
                      </button>
                      <button
                        onClick={() => void save(r)}
                        disabled={busy === r.messageId}
                        className="btn btn-glass text-[12px] disabled:opacity-50"
                      >
                        {busy === r.messageId ? "Собираю" : "Скачать в Word"}
                      </button>
                    </span>
                  </div>
                </div>

                {opened ? (
                  <div className="mt-4 max-h-[560px] overflow-y-auto border-t border-[color:var(--color-line)] pt-4">
                    {text[r.messageId] ? (
                      <Markdown>{text[r.messageId]!}</Markdown>
                    ) : (
                      <p className="text-[12.5px] text-muted-foreground">Открываю…</p>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          {rows.length ? "По этому запросу ничего нет." : "Пока ни один агент не отдал разбор."}
        </p>
      )}
    </div>
  );
}

/** Дата человеческим языком: сегодня, вчера или число. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  return d.toLocaleDateString("ru-RU");
}
