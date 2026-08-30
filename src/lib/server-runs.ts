/**
 * Прогоны по составу согласующих: что идёт прямо сейчас. Только сервер.
 *
 * Один заход к агенту занимает минуты, а состав — это семь заходов подряд, то
 * есть полчаса. Столько держать открытым запрос из браузера нельзя: связь
 * оборвётся раньше, чем придёт первый ответ, и человек решит, что всё сломалось.
 * Поэтому прогон живёт сам по себе на сервере, а браузер только спрашивает
 * «как там» — вот здесь и лежит ответ на этот вопрос.
 *
 * Всё держится в памяти процесса, как и очередь к модели (server-queue.ts).
 * Перезапуск сервиса эту память теряет: прогон, шедший в момент выкатки, после
 * неё выглядит незапущенным. Это не потеря работы — реплики ролей пишутся на
 * диск сразу, по мере ответов, и после перезапуска видно, кто успел высказаться,
 * а кого надо догнать (см. panelStateServer: без живого прогона он считает
 * готовых по самим репликам). Заводить ради этого файл на диске не стали:
 * состояние, которое врёт после падения, хуже отсутствующего.
 *
 * Ключ — id разговора: он случайный и уникален на всю платформу, поэтому
 * прогоны разных людей друг о друга не спотыкаются. Наружу список окон всё
 * равно отдаётся только после сверки с разговорами самого человека.
 */

export type PanelRun = {
  /** Сколько ролей в составе всего — вместе с теми, кто высказался раньше */
  total: number;
  /** Кто уже посмотрел документ: и до прогона, и по ходу него */
  doneRoleIds: string[];
  /** Кто читает документ прямо сейчас. Ролей ждём по одной, поэтому она одна */
  currentRoleId: string | null;
  /** Кому не удалось ответить: прогон из-за одной роли не останавливается */
  failedRoleIds: string[];
  startedAt: string;
};

const runs = new Map<string, PanelRun>();

/** Копию, а не саму запись: наружу уезжает состояние, а не рычаг управления. */
export function panelRunOf(windowId: string): PanelRun | null {
  const run = runs.get(windowId);
  if (!run) return null;
  return { ...run, doneRoleIds: [...run.doneRoleIds], failedRoleIds: [...run.failedRoleIds] };
}

export const isPanelRunning = (windowId: string): boolean => runs.has(windowId);

/** Разговоры, по которым сейчас идёт прогон — для «что в работе» в кабинете. */
export const runningWindowIds = (): string[] => [...runs.keys()];

/**
 * Начать прогон. Уже начатый второй раз не начинаем и здесь же об этом говорим:
 * два прогона по одному разговору писали бы ответы поверх друг друга.
 */
export function startPanelRun(
  windowId: string,
  init: { total: number; doneRoleIds: string[] },
): PanelRun | null {
  if (runs.has(windowId)) return null;
  const run: PanelRun = {
    total: init.total,
    doneRoleIds: [...init.doneRoleIds],
    currentRoleId: null,
    failedRoleIds: [],
    startedAt: new Date().toISOString(),
  };
  runs.set(windowId, run);
  return run;
}

/** Роль пошла читать документ. */
export function panelRoleStarted(windowId: string, roleId: string): void {
  const run = runs.get(windowId);
  if (run) run.currentRoleId = roleId;
}

/**
 * Роль закончила. ok — ответила ли она на самом деле.
 *
 * Неудачу записываем, но прогон продолжаем: остальным ролям сорванный ответ
 * одной не мешает, а человеку лучше получить шесть разборов из семи, чем ноль.
 */
export function panelRoleFinished(windowId: string, roleId: string, ok: boolean): void {
  const run = runs.get(windowId);
  if (!run) return;
  if (run.currentRoleId === roleId) run.currentRoleId = null;
  const list = ok ? run.doneRoleIds : run.failedRoleIds;
  if (!list.includes(roleId)) list.push(roleId);
}

/** Прогон закончился — любым образом, в том числе сорвавшись. */
export function finishPanelRun(windowId: string): void {
  runs.delete(windowId);
}

/** Сколько минут идёт прогон — чтобы сказать это человеку словами, а не в мс. */
export function minutesSince(startedAt: string): number {
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.round((Date.now() - started) / 60_000));
}

// ── Сборка документа в четыре прогона ────────────────────────────────────────
/**
 * То же, что и прогон по составу, но для конвейера сборки: четыре модели
 * подряд — это десять-пятнадцать минут, столько браузер запрос не держит.
 * Работа живёт на сервере, браузер спрашивает «на каком шаге».
 */

export type BuildStep = {
  passId: string;
  name: string;
  /** ждёт · идёт · готово · сорвалось · пропущен */
  state: "waiting" | "running" | "done" | "failed" | "skipped";
  /** Сколько шёл шаг, секунды */
  seconds: number;
  /** Почему сорвался — человеку словами */
  note: string;
};

export type BuildRun = {
  buildId: string;
  steps: BuildStep[];
  startedAt: string;
};

const builds = new Map<string, BuildRun>();

export function buildRunOf(windowId: string): BuildRun | null {
  const run = builds.get(windowId);
  return run ? { ...run, steps: run.steps.map((s) => ({ ...s })) } : null;
}

export const isBuildRunning = (windowId: string): boolean => builds.has(windowId);

export function startBuildRun(
  windowId: string,
  init: { buildId: string; steps: { passId: string; name: string }[] },
): BuildRun | null {
  if (builds.has(windowId)) return null;
  const run: BuildRun = {
    buildId: init.buildId,
    steps: init.steps.map((s) => ({ ...s, state: "waiting", seconds: 0, note: "" })),
    startedAt: new Date().toISOString(),
  };
  builds.set(windowId, run);
  return run;
}

export function buildStepStarted(windowId: string, passId: string): void {
  const run = builds.get(windowId);
  const step = run?.steps.find((s) => s.passId === passId);
  if (step) step.state = "running";
}

export function buildStepFinished(
  windowId: string,
  passId: string,
  outcome: { state: BuildStep["state"]; seconds: number; note?: string },
): void {
  const run = builds.get(windowId);
  const step = run?.steps.find((s) => s.passId === passId);
  if (!step) return;
  step.state = outcome.state;
  step.seconds = outcome.seconds;
  step.note = outcome.note ?? "";
}

export const finishBuildRun = (windowId: string): void => void builds.delete(windowId);
