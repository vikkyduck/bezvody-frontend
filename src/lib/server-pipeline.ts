/**
 * Сборка документа в четыре прогона. Только сервер.
 *
 * Разговор с агентом доводит фактуру, сборка делает документ. Это разные
 * работы, и запускаются они по-разному: разговор — репликой, сборка — кнопкой.
 *
 * Прогоны идут по очереди, каждый получает текст предыдущего. Первый видит
 * весь разбор с человеком и документы задачи; остальным документы не нужны —
 * они работают с текстом, и второй раз тащить к ним стомегабайтные выгрузки
 * значит платить за них четыре раза.
 *
 * Живёт всё это на сервере само по себе: четыре модели подряд — десять-
 * пятнадцать минут, столько браузер запрос не держит. Браузер спрашивает
 * «на каком шаге» и ждёт.
 *
 * Промежуточные версии сохраняются целиком. Без них усушке нельзя доверять:
 * не видно, что именно выпало.
 */
import { createServerFn } from "@tanstack/react-start";

import type { Attachment } from "./documents";
import { compareFacts, factReportText } from "./factcheck";
import { cleanPass, passesOf, type AgentPass } from "./passes";
import { normalizeConfig, type AgentConfig } from "./server-agents";
import { askKey } from "./server-windows";

const stamp = () => new Date().toISOString();
const rid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

/** Сколько сборок помним по одному разговору: дальше это архив, а не работа. */
const KEEP_BUILDS = 5;

export type BuildVersion = {
  passId: string;
  name: string;
  text: string;
  seconds: number;
};

export type StoredBuild = {
  id: string;
  windowId: string;
  at: string;
  versions: BuildVersion[];
};

const buildsFile = async (personId: string) =>
  `${(await import("./server-data")).dataDir()}/builds/${personId}.json`;

async function readBuilds(personId: string): Promise<StoredBuild[]> {
  const d = await import("./server-data");
  return d.readJson<StoredBuild[]>(await buildsFile(personId), []);
}

async function writeBuilds(personId: string, list: StoredBuild[]): Promise<void> {
  const d = await import("./server-data");
  await d.writeJson(await buildsFile(personId), list);
}

// ── Запуск ───────────────────────────────────────────────────────────────────

/** Первому прогону нужен повод заговорить: это не вопрос человека, а команда. */
const START_TEXT =
  "Собери документ по всему, что мы разобрали выше, и по приложенным материалам. " +
  "Верни две части: «# Документ» и «# Разбор и вопросы».";

export const runBuildServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; windowId: string }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; note: string }> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { ok: false, note: "Кабинет вас не узнал — войдите по коду ещё раз" };

    const q = await import("./server-queue");
    const runs = await import("./server-runs");
    const key = askKey(me.id, data.windowId);

    const { windows } = await d.readWorkspace(me.id);
    const target = windows.find((w) => w.id === data.windowId);
    if (!target) return { ok: false, note: "Разговор не найден — обновите страницу" };

    const cfgAll = await d.readJson<Record<string, Partial<AgentConfig>>>(
      `${d.dataDir()}/agents.json`,
      {},
    );
    const cfg = normalizeConfig(cfgAll[target.agentId], target.agentId);
    const steps = passesOf(target.agentId, cfg.passes)
      .map(cleanPass)
      .filter((p) => p.enabled && p.prompt);

    if (!steps.length) return { ok: false, note: "У этого агента конвейер сборки не настроен" };

    if (runs.isBuildRunning(data.windowId)) return { ok: false, note: "Документ уже собирается" };
    if (q.isAsking(key))
      return {
        ok: false,
        note: "В этом разговоре ещё пишется ответ — дождитесь его и запускайте сборку",
      };

    const buildId = rid("b");
    const shape = steps.map((p) => ({ passId: p.id, name: p.name }));
    if (!runs.startBuildRun(data.windowId, { buildId, steps: shape }))
      return { ok: false, note: "Документ уже собирается" };
    // Ключ занятости держим на всю сборку: реплика человека, влезшая между
    // прогонами, легла бы в разговор поверх собираемого документа.
    q.startAsking(key);

    // Дальше работа, которая переживёт этот запрос. Ошибку ловим сами:
    // необработанный отказ обещания роняет процесс, то есть чужие разговоры.
    void (async () => {
      try {
        await runPasses({
          personId: me.id,
          personName: me.name,
          windowId: data.windowId,
          buildId,
          steps,
        });
      } catch (err) {
        console.error(
          `[сборка] ${me.name} · сорвалась целиком: ` +
            (err instanceof Error ? err.message.slice(0, 200) : "неизвестная ошибка"),
        );
      } finally {
        runs.finishBuildRun(data.windowId);
        q.doneAsking(key);
      }
    })();

    return { ok: true, note: `Пошла сборка: ${steps.length} шага впереди` };
  });

// ── Сами прогоны ─────────────────────────────────────────────────────────────

async function runPasses(opts: {
  personId: string;
  personName: string;
  windowId: string;
  buildId: string;
  steps: AgentPass[];
}): Promise<void> {
  const d = await import("./server-data");
  const runs = await import("./server-runs");
  const q = await import("./server-queue");
  const { askAgent } = await import("./server-llm");

  const { projects, windows } = await d.readWorkspace(opts.personId);
  const target = windows.find((w) => w.id === opts.windowId);
  if (!target) return;
  const project = projects.find((p) => p.id === target.projectId) ?? null;

  const cfgAll = await d.readJson<Record<string, Partial<AgentConfig>>>(
    `${d.dataDir()}/agents.json`,
    {},
  );
  const cfg = normalizeConfig(cfgAll[target.agentId], target.agentId);

  const versions: BuildVersion[] = [];
  /** Что не прошло: человек должен знать, через сколько рук прошёл его документ */
  const failed: string[] = [];
  /** Текст сборки — с ним сверяется итог на последнем прогоне. */
  let assembled = "";
  let text = "";

  for (const [i, pass] of steps(opts.steps)) {
    const label = `сборка/${pass.id} · ${opts.personName}`;
    runs.buildStepStarted(opts.windowId, pass.id);
    const startedAt = Date.now();

    // Первый прогон видит разговор и документы задачи, остальные — только текст.
    const first = i === 0;
    let systemPrompt = pass.prompt;
    let question = text;
    let attachments: Attachment[] = [];
    let history: typeof target.messages = [];

    if (first) {
      // Инструкция агента остаётся: методика заказчика живёт в ней, а промпт
      // прогона говорит только про форму работы.
      systemPrompt = [cfg.prompt.trim(), pass.prompt.trim()].filter(Boolean).join("\n\n---\n\n");
      question = START_TEXT;
      // Разбор с человеком — это и есть материал сборки.
      history = target.messages.filter((m) => !m.roleId);
      const { attachmentsFor } = await import("./server-files");
      const packed = await attachmentsFor({
        agentId: target.agentId,
        personId: opts.personId,
        windowFiles: [...(project?.files ?? []), ...target.files],
      });
      attachments = packed.items;
    } else if (pass.id === "verify") {
      // Верификатору нужны оба текста и машинная сверка: без исходного он
      // не сверяет, а просто перечитывает итог.
      const report = compareFacts(assembled, text);
      question =
        `ИСХОДНЫЙ ДОКУМЕНТ (после сборки)\n<<<\n${assembled}\n>>>\n\n` +
        `ИТОГОВЫЙ ДОКУМЕНТ (после языка и объёма)\n<<<\n${text}\n>>>\n\n` +
        factReportText(report);
      console.log(`[сборка] ${opts.personName} · машинная сверка: расхождений ${report.total}`);
    }

    const answer = await q.modelGate.run(() =>
      askAgent({
        systemPrompt,
        model: pass.model,
        provider: pass.provider,
        agentId: target.agentId,
        history,
        question,
        attachments,
        label,
      }),
    );

    const seconds = Math.round((Date.now() - startedAt) / 1000);

    if (!answer.ok) {
      const note =
        answer.reason === "no-key"
          ? `ключ ${answer.detail ?? ""} не задан`.trim()
          : answer.reason === "busy"
            ? "модель занята"
            : (answer.detail ?? "ошибка связи");
      runs.buildStepFinished(opts.windowId, pass.id, { state: "failed", seconds, note });
      failed.push(`${pass.name} — ${note}`);
      console.warn(`[сборка] ${label} · ${seconds}с · сорвался: ${note}`);
      // Прогон сорвался — отдаём человеку то, что успели собрать. Пустой
      // результат хуже неполного: неполный можно дочитать глазами.
      if (first) return;
      break;
    }

    text = answer.text;
    if (first) assembled = text;
    versions.push({ passId: pass.id, name: pass.name, text, seconds });
    runs.buildStepFinished(opts.windowId, pass.id, { state: "done", seconds });
  }

  if (!text) return;

  // Прогон не прошёл — документ всё равно отдаём, но говорим об этом прямо
  // в разборе: иначе человек решит, что перед ним готовая работа.
  const passed = versions.map((v) => v.name).join(" → ");
  const finalText = failed.length
    ? `${text}\n\nСБОРКА\nДокумент прошёл: ${passed}. Не прошёл: ${failed.join("; ")}. ` +
      "Это версия последнего удавшегося прогона — не итоговая."
    : text;

  await saveResult({
    personId: opts.personId,
    windowId: opts.windowId,
    buildId: opts.buildId,
    versions,
    text: finalText,
  });
}

/** Пронумерованные шаги: индекс нужен, чтобы отличить первый прогон. */
function* steps(list: AgentPass[]): Generator<[number, AgentPass]> {
  for (let i = 0; i < list.length; i++) yield [i, list[i]!];
}

// ── Итог в разговор ──────────────────────────────────────────────────────────

async function saveResult(opts: {
  personId: string;
  windowId: string;
  buildId: string;
  versions: BuildVersion[];
  text: string;
}): Promise<void> {
  const d = await import("./server-data");
  const windows = await d.readWindows(opts.personId);
  const answerId = rid("m");

  const next = windows.map((w) => {
    if (w.id !== opts.windowId) return w;
    return {
      ...w,
      updatedAt: stamp(),
      docs: [
        ...w.docs,
        {
          id: rid("d"),
          title: `Документ от ${new Date().toLocaleDateString("ru-RU")}`,
          kind: "Собранный документ",
          at: stamp(),
          messageId: answerId,
        },
      ],
      messages: [
        ...w.messages,
        { id: answerId, from: "agent" as const, text: opts.text, at: stamp() },
      ],
    };
  });
  await d.writeWindows(opts.personId, next);

  // Промежуточные версии — отдельно от разговора: в переписке им не место,
  // а сверить, что выпало при усушке, без них нельзя.
  const builds = await readBuilds(opts.personId);
  const mine = builds.filter((b) => b.windowId === opts.windowId).slice(-(KEEP_BUILDS - 1));
  const others = builds.filter((b) => b.windowId !== opts.windowId);
  await writeBuilds(opts.personId, [
    ...others,
    ...mine,
    { id: opts.buildId, windowId: opts.windowId, at: stamp(), versions: opts.versions },
  ]);
}

// ── Что показывать человеку ──────────────────────────────────────────────────

export type BuildState = {
  running: boolean;
  steps: import("./server-runs").BuildStep[];
  minutes: number;
};

export const buildStateServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; windowId: string }) => data)
  .handler(async ({ data }): Promise<BuildState> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { running: false, steps: [], minutes: 0 };

    const runs = await import("./server-runs");
    const run = runs.buildRunOf(data.windowId);
    if (!run) return { running: false, steps: [], minutes: 0 };
    return { running: true, steps: run.steps, minutes: runs.minutesSince(run.startedAt) };
  });

/** Список сборок разговора — без текстов: они тяжёлые и нужны по одной. */
export const buildsServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; windowId: string; personId?: string }) => data)
  .handler(
    async ({
      data,
    }): Promise<{
      builds: {
        id: string;
        at: string;
        versions: { passId: string; name: string; chars: number }[];
      }[];
    }> => {
      const d = await import("./server-data");
      const { me } = await d.whoIs(String(data.code ?? ""));
      if (!me) return { builds: [] };

      const wanted = data.personId?.trim();
      if (wanted && wanted !== me.id && me.role !== "admin") return { builds: [] };
      const ownerId = wanted || me.id;

      const builds = await readBuilds(ownerId);
      return {
        builds: builds
          .filter((b) => b.windowId === data.windowId)
          .map((b) => ({
            id: b.id,
            at: b.at,
            versions: b.versions.map((v) => ({
              passId: v.passId,
              name: v.name,
              chars: v.text.length,
            })),
          }))
          .reverse(),
      };
    },
  );

/** Текст одной версии — по запросу. */
export const buildVersionServer = createServerFn({ method: "POST" })
  .validator((data: { code: string; buildId: string; passId: string; personId?: string }) => data)
  .handler(async ({ data }): Promise<{ text: string }> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { text: "" };

    const wanted = data.personId?.trim();
    if (wanted && wanted !== me.id && me.role !== "admin") return { text: "" };
    const ownerId = wanted || me.id;

    const build = (await readBuilds(ownerId)).find((b) => b.id === data.buildId);
    return { text: build?.versions.find((v) => v.passId === data.passId)?.text ?? "" };
  });
