/**
 * Цифровая виза — отметка о том, что документ прогнали через систему.
 *
 * Зачем она. Руководителю приносят документ, и первый его вопрос не «что
 * написано», а «стоит ли это читать». Виза отвечает ровно на него: прогнали
 * ли документ через агентов, услышал ли автор возражения тех, кто будет
 * согласовывать, и что он сделал после этих возражений. Не «оценка качества»
 * и не «одобрено платформой» — только факты о проделанной работе.
 *
 * Всё считается из того, что и так лежит в разговорах: ничего специально
 * ради визы человек не заполняет. Заполняемое поле здесь было бы формальностью,
 * которую проставляют не глядя.
 *
 * Виза НЕ содержит ни строчки из переписки и ни одного документа: руководитель
 * видит, что работа шла, а читать документ он будет там, куда его пришлют.
 */
import type { StoredWindow } from "./conversations";
import type { StoredProject } from "./projects";
// Из role-marks, а не из roles: там инструкции ролей, и в браузер
// они попасть не должны — виза считается на клиенте тоже.
import { ROLE_OPENING, ROLE_VERDICT } from "./role-marks";
import { agentById } from "./shtab-data";

/** Ступень, до которой доведена задача. Порядок важен: он же порядок сортировки. */
export type VisaStage = "не начата" | "в работе" | "прогнано" | "прогнано и доработано";

export type Visa = {
  stage: VisaStage;
  /** С кем говорили и сколько развёрнутых разборов получили */
  agents: { name: string; documents: number }[];
  /** Ролей высказалось — из тех, кого прогоняли по документу */
  rolesSpoke: number;
  /** Сколько раз просили роль подвести итог */
  verdicts: number;
  /**
   * Сколько вердиктов закончились возвратом на доработку. Читается из текста
   * вердикта («возвращаю на доработку» — формулировка из инструкции роли),
   * поэтому число осторожное: не разобрали — не посчитали.
   */
  returned: number;
  /** Реплик автора после последнего вердикта: работал ли он с замечаниями */
  afterVerdict: number;
  /** Готовых разборов по задаче */
  documents: number;
  /** Документов принесено в задачу */
  files: number;
  /** Последнее движение по задаче */
  lastAt: string;
};

/**
 * Разбор, а не реплика. Тот же порог, по которому в кабинете под ответом
 * появляется кнопка «Забрать документ», — иначе уточняющий вопрос агента
 * считался бы проделанной работой.
 */
const isDocument = (text: string) => text.trim().length >= 600 || /^#{1,3}\s/m.test(text);

/** Вердикт роли — реплику с этой просьбой пишет платформа, не человек. */
const isVerdictAsk = (text: string) => text === ROLE_VERDICT;
const isOpeningAsk = (text: string) => text === ROLE_OPENING;

export function visaOf(project: StoredProject, windows: StoredWindow[]): Visa {
  const mine = windows.filter((w) => w.projectId === project.id);

  const agents = mine
    .map((w) => ({
      name: agentById(w.agentId)?.name ?? "агент",
      documents: w.messages.filter((m) => m.from === "agent" && isDocument(m.text)).length,
    }))
    .filter((a) => a.documents > 0);

  const roleIds = new Set<string>();
  let verdicts = 0;
  let returned = 0;
  let afterVerdict = 0;

  for (const w of mine) {
    for (const m of w.messages) if (m.from === "agent" && m.roleId) roleIds.add(m.roleId);

    // Порядок реплик в разговоре — это и есть ход работы: просьба подвести
    // итог, вердикт роли, и всё, что автор сказал после него.
    let lastVerdictAt = -1;
    for (let i = 0; i < w.messages.length; i++) {
      const m = w.messages[i]!;
      if (m.from !== "user" || !isVerdictAsk(m.text)) continue;
      verdicts += 1;
      const answer = w.messages[i + 1];
      // Кириллицу приходится перечислять руками: \w в JavaScript — это только
      // латиница с цифрами, и «возвращаю» ему не подходит.
      if (answer?.from === "agent" && /возвращ[а-яё]*\s+на\s+доработку/i.test(answer.text)) {
        returned += 1;
      }
      lastVerdictAt = i;
    }
    if (lastVerdictAt >= 0) {
      afterVerdict += w.messages
        .slice(lastVerdictAt + 1)
        .filter((m) => m.from === "user" && !isVerdictAsk(m.text) && !isOpeningAsk(m.text)).length;
    }
  }

  const documents = agents.reduce((n, a) => n + a.documents, 0);
  const lastAt = mine.reduce(
    (max, w) => (w.updatedAt > max ? w.updatedAt : max),
    project.updatedAt,
  );

  let stage: VisaStage = "не начата";
  if (mine.length) stage = "в работе";
  if (documents > 0) stage = "прогнано";
  // Доработка засчитывается только после вердикта: иначе «поговорил ещё» и
  // «отработал возражения» слились бы в одно, а это разные вещи.
  if (documents > 0 && verdicts > 0 && afterVerdict > 0) stage = "прогнано и доработано";

  return {
    stage,
    agents,
    rolesSpoke: roleIds.size,
    verdicts,
    returned,
    afterVerdict,
    documents,
    files: project.files.length,
    lastAt,
  };
}

/**
 * Чем закончила конкретная роль. Нужно и руководителю в панели, и автору
 * в составе согласующих: «высказался» и «вернул на доработку» — разные вещи,
 * и по списку должно быть видно, где документ застрял.
 */
export type RoleOutcome = "молчит" | "высказался" | "вернул на доработку";

/**
 * Вердикт роли целиком: чем закончила, когда и какими словами.
 *
 * «Вернул на доработку» от финдиректора — это событие, а не строка списка.
 * Чтобы показать его штампом, экрану нужны три вещи: исход, дата и сама
 * формулировка, — поэтому достаём их одним проходом, а не тремя.
 */
export type RoleStamp = {
  outcome: RoleOutcome;
  /** Когда роль поставила вердикт */
  at: string;
  /** Что именно сказала — последняя фраза вердикта, без разметки */
  words: string;
};

export function roleStamp(window: StoredWindow, roleId: string): RoleStamp | null {
  const mine = window.messages.filter((m) => m.roleId === roleId);
  let found: RoleStamp | null = null;
  for (let i = 0; i < mine.length; i++) {
    const ask = mine[i]!;
    if (ask.from !== "user" || ask.text !== ROLE_VERDICT) continue;
    const answer = mine[i + 1];
    if (answer?.from !== "agent") continue;
    const back = /возвращ[а-яё]*\s+на\s+доработку/i.test(answer.text);
    found = {
      outcome: back ? "вернул на доработку" : "высказался",
      at: answer.at,
      words: verdictWords(answer.text),
    };
  }
  return found;
}

/**
 * Сама формулировка вердикта: последний абзац ответа роли.
 *
 * По методике роль заканчивает вердиктом, и он всегда в конце. Берём хвост,
 * а не начало: начало — это разбор, а на штампе нужен приговор.
 */
function verdictWords(text: string): string {
  const lines = text
    .split(/\n+/)
    .map((l) =>
      l
        .replace(/^[#>*\-\s]+/, "")
        .replace(/\*\*/g, "")
        .trim(),
    )
    .filter((l) => l.length > 12);
  const tail = lines[lines.length - 1] ?? "";
  return tail.length <= 220 ? tail : `${tail.slice(0, 219).trimEnd()}…`;
}

export function roleOutcome(window: StoredWindow, roleId: string): RoleOutcome {
  const mine = window.messages.filter((m) => m.roleId === roleId);
  if (!mine.some((m) => m.from === "agent")) return "молчит";
  for (let i = 0; i < mine.length; i++) {
    const ask = mine[i]!;
    if (ask.from !== "user" || ask.text !== ROLE_VERDICT) continue;
    const answer = mine[i + 1];
    // Кириллицу перечисляем руками: \w в JavaScript — только латиница.
    if (answer?.from === "agent" && /возвращ[а-яё]*\s+на\s+доработку/i.test(answer.text)) {
      return "вернул на доработку";
    }
  }
  return "высказался";
}

/** Одной строкой — то, что руководитель читает первым. */
export function visaLine(v: Visa): string {
  if (v.stage === "не начата") return "Задача заведена, работа не начиналась";
  const bits: string[] = [];
  if (v.agents.length) bits.push(v.agents.map((a) => a.name).join(", "));
  if (v.rolesSpoke) bits.push(`ролей высказалось ${v.rolesSpoke}`);
  if (v.returned) bits.push(`вернули на доработку ${v.returned}`);
  if (v.afterVerdict) bits.push(`после замечаний ответов ${v.afterVerdict}`);
  return bits.join(" · ") || "Разговор начат, разбора пока нет";
}
