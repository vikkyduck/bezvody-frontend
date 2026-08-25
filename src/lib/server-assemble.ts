/**
 * «Собрать решение» — один документ Word из отмеченных ответов. Только сервер.
 *
 * За неделю по одной задаче набирается решение архитектора, вердикты
 * согласующих, пояснительная записка и расчёт — и до сих пор человек сшивал
 * это в Word сам: открывал десяток файлов, склеивал, правил заголовки, делал
 * оглавление. То есть ровно ту работу, ради избавления от которой платил.
 *
 * Здесь то же самое делает платформа. Что войдёт в документ и в каком
 * порядке — решает человек: он отмечает части, мы их не выбираем и не
 * сортируем. Разборы («Разбор и вопросы») из основной части вынимаются и
 * уезжают приложениями в конец — это то, что автор отрезает перед отправкой.
 *
 * Файл не храним: собирается по запросу, значит всегда соответствует тому,
 * что человек видит на экране.
 */
import { createServerFn } from "@tanstack/react-start";

import type { StoredMessage, StoredWindow } from "./conversations";
import type { AgentConfig } from "./server-agents";
import type { AssembledPart } from "./server-docx";
import { agentById } from "./shtab-data";

/** Одна отмеченная часть: ответ агента в разговоре задачи. */
export type AssemblePart = { windowId: string; messageId: string };

export type AssembleResult = {
  ok: boolean;
  /** Имя файла — название задачи и дата */
  name: string;
  base64: string;
  /** Что получилось, человеческими словами: показать рядом с кнопкой */
  note: string;
};

/**
 * Сколько частей берём разом.
 *
 * Ограничение не про производительность, а про смысл: документ, в котором
 * сорок разделов, никто не прочитает, а собрать его человек мог только
 * промахнувшись по «отметить все».
 */
const MAX_PARTS = 40;

type AgentConfigs = Record<string, Partial<AgentConfig>>;

export const assembleServer = createServerFn({ method: "POST" })
  .validator(
    (data: {
      code: string;
      projectId: string;
      /** В порядке, который выбрал человек. Мы его не трогаем */
      parts: AssemblePart[];
      personId?: string;
    }) => data,
  )
  .handler(async ({ data }): Promise<AssembleResult> => {
    const deny = (note: string): AssembleResult => ({ ok: false, name: "", base64: "", note });

    const d = await import("./server-data");
    const { list, me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return deny("Кабинет вас не узнал — войдите по коду ещё раз.");

    // Чужое решение собирает только администратор — как и чужой разбор.
    const wanted = data.personId?.trim();
    if (wanted && wanted !== me.id && me.role !== "admin")
      return deny("Чужое решение собирает только администратор.");
    const ownerId = wanted || me.id;

    const asked = (Array.isArray(data.parts) ? data.parts : [])
      .filter((p) => p?.windowId && p?.messageId)
      // Отмеченное дважды — почти наверняка промах, а в документе это выйдет
      // одним и тем же разделом два раза подряд.
      .filter(
        (p, i, all) =>
          all.findIndex((x) => x.windowId === p.windowId && x.messageId === p.messageId) === i,
      );
    if (!asked.length) return deny("Не отмечено ни одной части.");
    const taken = asked.slice(0, MAX_PARTS);

    const { projects, windows } = await d.readWorkspace(ownerId);
    const project = projects.find((p) => p.id === data.projectId);
    if (!project) return deny("Задача не найдена.");

    const byId = new Map(windows.map((w) => [w.id, w]));
    const configs = await d.readJson<AgentConfigs>(`${d.dataDir()}/agents.json`, {});

    const parts: AssembledPart[] = [];
    let lost = 0;
    for (const want of taken) {
      const w = byId.get(want.windowId);
      // Разговор из другой задачи в документ не попадает. Человек собирает
      // решение по одной задаче, и подмешать туда чужую переписку не должно
      // получаться даже по ошибке.
      if (!w || w.projectId !== project.id) {
        lost++;
        continue;
      }
      const answer = w.messages.find((m) => m.id === want.messageId && m.from === "agent");
      if (!answer?.text.trim()) {
        lost++;
        continue;
      }
      const markdown = await forDocument(answer.text);
      parts.push({ title: await partTitle(w, answer, markdown, configs), markdown });
    }

    if (!parts.length)
      return deny("Ни одна из отмеченных частей не нашлась — обновите страницу и отметьте заново.");

    const owner = list.find((p) => p.id === ownerId);
    const meta = {
      // Документ называется задачей: его пересылают и кладут на стол, и первая
      // реплика из разговора в этой роли не работает.
      task: project.title.trim() || "Решение",
      person: owner?.name ?? "",
      company: owner?.company ?? "",
      // Дата сборки, а не дата ответов: части написаны в разные дни, а документ
      // собран сегодня — и датой подписан именно он.
      date: d.today(),
    };

    const { assembledToDocx, docxFileName } = await import("./server-docx");
    const file = await assembledToDocx(parts, meta);

    const note = [
      `Собрано частей: ${parts.length}.`,
      lost ? `Не нашлось: ${lost} — этих ответов в задаче уже нет.` : "",
      asked.length > taken.length ? `Взяли первые ${MAX_PARTS}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    return { ok: true, name: docxFileName(meta), base64: file.toString("base64"), note };
  });

/**
 * Название части — то, что человек увидит в оглавлении.
 *
 * Вердикт роли называем ролью: «Вердикт: Финансовый директор» — так его и
 * ищут в документе. У обычного агента берём первый заголовок его ответа: он
 * написан под задачу и различает части лучше любой подписи снаружи.
 *
 * Заголовка нет — подписываем должностью агента, а не его именем. «Никита» в
 * оглавлении документа, который несут на совет директоров, читается как
 * сотрудник, которого в компании нет; «Архитектор решения» читается как
 * раздел. Имени агента и бренда платформы в документе не должно быть нигде.
 */
async function partTitle(
  w: StoredWindow,
  answer: StoredMessage,
  markdown: string,
  configs: AgentConfigs,
): Promise<string> {
  if (answer.roleId) {
    const { rolesOf, roleById } = await import("./server-agents");
    const role = roleById(rolesOf(w.agentId, configs[w.agentId]), answer.roleId);
    if (role) return `Вердикт: ${role.name}`;
  }

  const { firstHeadingOf } = await import("./server-docx");
  const head = clean(await firstHeadingOf(markdown));
  if (head) return head;

  const agent = agentById(w.agentId);
  return clean(agent?.role || agent?.name || "") || "Часть решения";
}

/** Заголовок в одну строку и без хвостовой пунктуации: он идёт в оглавление. */
function clean(raw: string): string {
  const one = raw
    .replace(/\s+/g, " ")
    .replace(/[.:;,\s]+$/, "")
    .trim();
  return one.length <= 90 ? one : `${one.slice(0, 89).trimEnd()}…`;
}

/**
 * Текст ответа для документа.
 *
 * Ответ счетовода несёт служебную таблицу «лист / ячейка / значение» — по ней
 * платформа заполняет шаблон Excel. Человеку в собранном решении она
 * бесполезна и занимает страницы: «Вводные C14 = 6290» не говорит ничего.
 * Убираем её тем же способом, что и одиночная выгрузка ответа.
 *
 * Подписи полей из шаблона агента здесь не подставляем — в собранном решении
 * это приложение к приложению; останутся адреса ячеек, а сама модель едет
 * отдельным файлом Excel, где у полей есть человеческие имена.
 */
async function forDocument(text: string): Promise<string> {
  const { answerForNote, cellsFromMarkdown } = await import("./server-xlsx");
  return cellsFromMarkdown(text).length ? answerForNote(text, []) : text;
}
