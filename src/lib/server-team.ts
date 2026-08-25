/**
 * Панель руководителя: над чем работают его люди.
 *
 * Просьба пришла от самих участников: «зачем мне читать документ, если через
 * систему его не прогоняли». Руководителю нужен не текст, а признак — довели
 * работу до конца или принесли черновик. Поэтому отсюда наружу уходят только
 * названия задач и цифровая виза: ни реплик, ни файлов, ни содержания разбора.
 *
 * Кто видит: кабинет с признаком leads и администратор. Служебные кабинеты
 * (hidden) в список не попадают.
 */
import { createServerFn } from "@tanstack/react-start";

import { isProjectOpen } from "./projects";
import type { Visa } from "./visa";

export type TeamTask = {
  id: string;
  title: string;
  visa: Visa;
  /** Задача закончена: в ленте активных ей делать нечего */
  closed: boolean;
};

export type TeamPerson = {
  id: string;
  name: string;
  position: string;
  lastUsedAt: string | null;
  tasks: TeamTask[];
};

export const teamServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; people: TeamPerson[]; note: string }> => {
    const deny = { ok: false, people: [] as TeamPerson[], note: "" };
    const d = await import("./server-data");
    const { list, me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { ...deny, note: "Кабинет вас не узнал — войдите по коду ещё раз." };
    if (!me.leads && me.role !== "admin") return deny;

    const { visaOf } = await import("./visa");

    // Себя в список не кладём: свою работу руководитель видит в своём кабинете,
    // а здесь он смотрит на команду.
    const team = list.filter((p) => p.role === "client" && p.active && !p.hidden && p.id !== me.id);

    const people: TeamPerson[] = [];
    for (const p of team) {
      const { projects, windows } = await d.readWorkspace(p.id);
      const tasks = projects
        .map((project) => ({
          id: project.id,
          title: project.title,
          visa: visaOf(project, windows),
          // Закончённая работа не должна мешаться среди идущей: руководитель
          // смотрит сюда, чтобы понять, что происходит СЕЙЧАС.
          closed: !isProjectOpen(project),
        }))
        // Свежее сверху: руководителя интересует, что происходит сейчас.
        .sort((a, b) => b.visa.lastAt.localeCompare(a.visa.lastAt));
      people.push({
        id: p.id,
        name: p.name,
        position: p.position,
        lastUsedAt: p.lastUsedAt,
        tasks,
      });
    }

    // Кто работает — выше тех, кто ещё не заходил.
    people.sort((a, b) => {
      const at = a.tasks[0]?.visa.lastAt ?? "";
      const bt = b.tasks[0]?.visa.lastAt ?? "";
      return bt.localeCompare(at);
    });

    return { ok: true, people, note: "" };
  });
