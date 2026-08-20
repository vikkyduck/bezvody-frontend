/**
 * Отчёты клиентов глазами администратора. Только сервер.
 *
 * Вопрос простой: что люди на самом деле получают. По карточкам участников
 * это выяснять долго — надо помнить, кто есть, и открывать каждого. Здесь
 * всё, что агенты собрали, одним списком: кто, когда, по какому вопросу
 * и что вышло.
 *
 * Список строится по материалам окон, а не по всем репликам подряд: материал
 * заводится только на удавшийся разбор, поэтому сообщения об ошибках сюда
 * не попадают — а именно они и есть «не отчёт».
 */
import { createServerFn } from "@tanstack/react-start";

export type ReportRow = {
  personId: string;
  personName: string;
  company: string;
  agentId: string;
  windowId: string;
  windowTitle: string;
  messageId: string;
  at: string;
  /** Объём разбора в знаках — по нему видно, документ это или отписка */
  chars: number;
  /** Первые строки, чтобы понять, о чём он, не открывая */
  preview: string;
};

const preview = (s: string) =>
  s
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);

export const listReportsServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }): Promise<{ reports: ReportRow[] }> => {
    const d = await import("./server-data");
    const { list, me } = await d.whoIs(String(data.code ?? ""));
    if (!me || me.role !== "admin") return { reports: [] };

    const rows: ReportRow[] = [];
    for (const person of list) {
      const windows = await d.readWindows(person.id);
      for (const w of windows) {
        // Материалы и ответы идут в одном порядке: у записей, сделанных до
        // появления ссылки на реплику, берём ответ по счёту.
        const answers = w.messages.filter((m) => m.from === "agent");
        w.docs.forEach((doc, i) => {
          const messageId = doc.messageId ?? answers[i]?.id;
          const answer = messageId ? w.messages.find((m) => m.id === messageId) : undefined;
          if (!answer) return;
          rows.push({
            personId: person.id,
            personName: person.name,
            company: person.company,
            agentId: w.agentId,
            windowId: w.id,
            windowTitle: w.title,
            messageId: answer.id,
            at: answer.at,
            chars: answer.text.length,
            preview: preview(answer.text),
          });
        });
      }
    }

    // Свежее сверху: администратора интересует «что сейчас», а не архив.
    rows.sort((a, b) => (a.at < b.at ? 1 : -1));
    return { reports: rows };
  });

/** Полный текст одного разбора — по запросу, чтобы список оставался лёгким. */
export const readReportServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; personId: string; windowId: string; messageId: string }) => data)
  .handler(async ({ data }): Promise<{ text: string }> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me || me.role !== "admin") return { text: "" };

    const windows = await d.readWindows(data.personId);
    const w = windows.find((x) => x.id === data.windowId);
    const answer = w?.messages.find((m) => m.id === data.messageId && m.from === "agent");
    return { text: answer?.text ?? "" };
  });
