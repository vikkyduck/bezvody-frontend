/**
 * Ответ агента — документом Word. Только сервер.
 *
 * Разбор на шесть страниц нужен человеку не в переписке, а на руках: его
 * пересылают, печатают, приносят на защиту решения. Поэтому собираем
 * настоящий .docx с заголовками, жирным, списками и таблицами — а не текст
 * со звёздочками и палочками, который в Word приходится причёсывать руками.
 *
 * Разметку разбираем тем же способом, что и экран (markdown → дерево), и по
 * дереву строим документ. Что не поддержано разметкой — превращается в
 * обычный абзац: лучше простой текст, чем пропавший кусок.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ISectionOptions,
  type ParagraphChild,
} from "docx";
import type { Root, RootContent, PhrasingContent, Heading, TableCell as MdTableCell } from "mdast";

const FONT = "Calibri";
const INK = "1A1A1A";
const MUTED = "6B6B6B";
const LINE = "D8D4CE";
const TINT = "F4F2EE";

type Marks = { bold?: boolean; italics?: boolean; strike?: boolean; code?: boolean };

// ── Строчный текст ────────────────────────────────────────────────────────────

/** Разворачиваем оформление внутрь: жирное внутри ссылки останется жирным. */
function inline(nodes: readonly PhrasingContent[], marks: Marks = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out.push(run(node.value, marks));
        break;
      case "strong":
        out.push(...inline(node.children, { ...marks, bold: true }));
        break;
      case "emphasis":
        out.push(...inline(node.children, { ...marks, italics: true }));
        break;
      case "delete":
        out.push(...inline(node.children, { ...marks, strike: true }));
        break;
      case "inlineCode":
        out.push(run(node.value, { ...marks, code: true }));
        break;
      case "break":
        out.push(new TextRun({ break: 1 }));
        break;
      case "link":
        out.push(
          new ExternalHyperlink({
            link: node.url,
            children: inline(node.children, marks),
          }),
        );
        break;
      case "image":
        // Картинки агент не рисует; если появится — оставим подпись.
        out.push(run(node.alt ?? node.url, { ...marks, italics: true }));
        break;
      default:
        if ("children" in node && Array.isArray(node.children)) {
          out.push(...inline(node.children as PhrasingContent[], marks));
        } else if ("value" in node && typeof node.value === "string") {
          out.push(run(node.value, marks));
        }
    }
  }

  return out;
}

/**
 * Пишем ТОЛЬКО включённое оформление.
 *
 * Соблазн передать `bold: false` велик, но тогда в документ уезжает
 * <w:b w:val="false"/>, и часть читалок (в том числе просмотр в macOS)
 * понимает это ровно наоборот — весь текст выходит жирным курсивом.
 * Выключенное свойство надёжнее не писать вовсе.
 */
const run = (text: string, m: Marks) =>
  new TextRun({
    text,
    ...(m.bold ? { bold: true } : {}),
    ...(m.italics ? { italics: true } : {}),
    ...(m.strike ? { strike: true } : {}),
    ...(m.code ? { font: "Consolas", size: 20, color: "3B3B3B" } : {}),
  });

// ── Блоки ─────────────────────────────────────────────────────────────────────

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

function cellParagraphs(cell: MdTableCell, header: boolean): Paragraph[] {
  const children = inline(cell.children, header ? { bold: true } : {});
  return [
    new Paragraph({
      children: children.length ? children : [run("", {})],
      spacing: { before: 40, after: 40 },
    }),
  ];
}

function blocks(nodes: readonly RootContent[], depth = 0): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case "heading": {
        out.push(
          new Paragraph({
            heading: HEADINGS[Math.min(node.depth, 6) - 1] ?? HeadingLevel.HEADING_4,
            children: inline(node.children),
          }),
        );
        break;
      }

      case "paragraph":
        out.push(new Paragraph({ children: inline(node.children) }));
        break;

      case "list": {
        let index = node.start ?? 1;
        for (const item of node.children) {
          const [first, ...rest] = item.children;
          const lead = first && first.type === "paragraph" ? inline(first.children) : [];
          // Нумерация своими руками: у Word свои списки живут отдельной
          // таблицей стилей, а нам нужен предсказуемый вид без сюрпризов.
          const marker = node.ordered ? `${index++}. ` : "— ";
          out.push(
            new Paragraph({
              children: [run(marker, {}), ...lead],
              indent: { left: 360 + depth * 360, hanging: 260 },
              spacing: { before: 40, after: 40 },
            }),
          );
          // Вложенные списки и абзацы внутри пункта — со сдвигом.
          if (rest.length) out.push(...blocks(rest, depth + 1));
        }
        break;
      }

      case "blockquote":
        for (const inner of blocks(node.children, depth)) {
          if (inner instanceof Paragraph) {
            out.push(
              new Paragraph({
                children: inline(
                  node.children[0] && node.children[0].type === "paragraph"
                    ? node.children[0].children
                    : [],
                  { italics: true },
                ),
                indent: { left: 360 },
                border: { left: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 12 } },
                spacing: { before: 120, after: 120 },
              }),
            );
            break;
          }
        }
        break;

      case "code":
        out.push(
          new Paragraph({
            children: node.value
              .split("\n")
              .flatMap((line, i) =>
                i
                  ? [new TextRun({ break: 1 }), run(line, { code: true })]
                  : [run(line, { code: true })],
              ),
            shading: { type: ShadingType.CLEAR, fill: TINT },
            spacing: { before: 120, after: 120 },
          }),
        );
        break;

      case "thematicBreak":
        out.push(
          new Paragraph({
            text: "",
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 8 } },
            spacing: { before: 160, after: 160 },
          }),
        );
        break;

      case "table": {
        const [head, ...body] = node.children;
        const rows: TableRow[] = [];
        if (head) {
          rows.push(
            new TableRow({
              tableHeader: true,
              children: head.children.map(
                (c) =>
                  new TableCell({
                    children: cellParagraphs(c, true),
                    shading: { type: ShadingType.CLEAR, fill: TINT },
                    margins: { top: 60, bottom: 60, left: 100, right: 100 },
                  }),
              ),
            }),
          );
        }
        for (const row of body) {
          rows.push(
            new TableRow({
              children: row.children.map(
                (c) =>
                  new TableCell({
                    children: cellParagraphs(c, false),
                    margins: { top: 60, bottom: 60, left: 100, right: 100 },
                  }),
              ),
            }),
          );
        }
        if (rows.length) {
          out.push(
            new Table({
              rows,
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 4, color: LINE },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE },
                left: { style: BorderStyle.NONE, size: 0, color: "auto" },
                right: { style: BorderStyle.NONE, size: 0, color: "auto" },
                insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: LINE },
                insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
              },
            }),
          );
          // После таблицы нужен абзац: два стола подряд Word склеивает.
          out.push(new Paragraph({ text: "", spacing: { after: 120 } }));
        }
        break;
      }

      default:
        if ("children" in node && Array.isArray(node.children)) {
          out.push(...blocks(node.children as RootContent[], depth));
        }
    }
  }

  return out;
}

// ── Две части ответа ─────────────────────────────────────────────────────────
/**
 * Ответ агента состоит из документа и разбора фактуры. Согласующим несут
 * первое, автору нужно второе — поэтому в файле они не перемешаны: разбор
 * уходит приложением с новой страницы, и его легко отрезать перед отправкой.
 *
 * Если агент не разметил части (старый ответ, свой текст правила) — весь
 * текст идёт документом. Потерять кусок хуже, чем не разделить.
 */
/** Текст заголовка без оформления: «**Документ**» и «Документ» — одно и то же. */
const flatText = (nodes: readonly PhrasingContent[]): string =>
  nodes
    .map((n) =>
      "value" in n && typeof n.value === "string"
        ? n.value
        : "children" in n && Array.isArray(n.children)
          ? flatText(n.children as PhrasingContent[])
          : "",
    )
    .join("")
    .trim();

const headingText = (h: Heading): string => flatText(h.children).toLowerCase();

const isReviewHeading = (n: RootContent): boolean =>
  n.type === "heading" && /разбор|вопрос/.test(headingText(n));

const isDocumentHeading = (n: RootContent): boolean =>
  n.type === "heading" && /^документ$/.test(headingText(n));

function splitAnswer(all: RootContent[]): { main: RootContent[]; review: RootContent[] } {
  const at = all.findIndex(isReviewHeading);
  const main = at >= 0 ? all.slice(0, at) : all;
  const review = at >= 0 ? all.slice(at + 1) : [];
  // Заголовок «Документ» дублирует шапку файла — он там уже есть.
  return { main: main.length && isDocumentHeading(main[0]!) ? main.slice(1) : main, review };
}

// ── Документ целиком ──────────────────────────────────────────────────────────

/**
 * Шапка документа.
 *
 * Этот файл несут на совет директоров и пересылают финдиректору, поэтому
 * выглядеть он должен документом заказчика, а не выгрузкой из чата. Раньше
 * заголовком стояла дословная реплика человека («посмотри, что тут не так»),
 * автором — имя агента, а первой строкой — бренд подрядчика; всё это
 * приходилось вычищать руками, то есть делать работу, за которую заплачено.
 */
export type DocxMeta = {
  /** Название задачи — им и озаглавлен документ */
  task: string;
  /** Чей это документ: его имя стоит автором */
  person: string;
  company: string;
  date: string;
};

/** Разметка в дерево. Разбираем ровно тем же способом, что и экран. */
async function parse(markdown: string): Promise<Root> {
  const { fromMarkdown } = await import("mdast-util-from-markdown");
  const { gfm } = await import("micromark-extension-gfm");
  const { gfmFromMarkdown } = await import("mdast-util-gfm");

  return fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }) as Root;
}

/** Строка-пояснение мелким серым: она объясняет, а не читается наравне с текстом. */
const aside = (text: string) =>
  new Paragraph({
    children: [new TextRun({ text, italics: true, color: MUTED, size: 19 })],
    spacing: { after: 200 },
  });

const REVIEW_ASIDE =
  "Эта часть — автору документа, а не согласующим: что в фактуре сильное и слабое, чем закрыть пустые графы. Перед отправкой её можно убрать.";

/**
 * Титул документа: название задачи, под ним автор и дата. Вопроса из чата
 * в шапке нет — он относится к переписке, а не к документу.
 */
const titleBlocks = (meta: DocxMeta): (Paragraph | Table)[] => [
  new Paragraph({
    children: [new TextRun({ text: meta.task, bold: true, size: 34 })],
    spacing: { after: 100 },
  }),
  new Paragraph({
    children: [
      new TextRun({
        text: [meta.person, meta.company, meta.date].filter(Boolean).join(" · "),
        color: MUTED,
        size: 19,
      }),
    ],
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 10 } },
    spacing: { after: 300 },
  }),
];

export async function answerToDocx(markdown: string, meta: DocxMeta): Promise<Buffer> {
  const tree = await parse(markdown);

  const { main, review } = splitAnswer(tree.children);
  const body = blocks(main);

  const appendix: (Paragraph | Table)[] = review.length
    ? [
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: "Приложение. Разбор и вопросы", bold: true })],
        }),
        aside(REVIEW_ASIDE),
        ...blocks(review),
      ]
    : [];

  return pack(meta, [...titleBlocks(meta), ...body, ...appendix]);
}

/** Поля, колонцифра, стили — одинаковые у одиночного ответа и у сборки. */
async function pack(meta: DocxMeta, children: (Paragraph | Table)[]): Promise<Buffer> {
  const section: ISectionOptions = {
    properties: {
      page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } },
    },
    footers: {
      // Колонцифра подписана задачей и датой: по ним документ узнают через
      // месяц на столе. Имени агента и названия платформы здесь нет — документ
      // принадлежит тому, кто его несёт.
      default: new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: `${shorten(meta.task, 70)} · ${meta.date} · `,
                color: MUTED,
                size: 16,
              }),
              new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 16 }),
            ],
          }),
        ],
      }),
    },
    children,
  };

  const doc = new Document({
    // Свойства файла Word видны в проводнике и в Google Документах. Автор —
    // человек: он этот документ защищает и им подписывается.
    creator: meta.person || "Автор",
    // Без этого библиотека пишет «Un-named» — видно в свойствах файла у того,
    // кому документ переслали.
    lastModifiedBy: meta.person || "Автор",
    title: meta.task,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 22, color: INK },
          paragraph: { spacing: { line: 288, after: 140 } },
        },
        heading1: {
          run: { font: FONT, size: 32, bold: true, color: INK },
          paragraph: { spacing: { before: 320, after: 140 } },
        },
        heading2: {
          run: { font: FONT, size: 27, bold: true, color: INK },
          paragraph: { spacing: { before: 280, after: 120 } },
        },
        heading3: {
          run: { font: FONT, size: 24, bold: true, color: INK },
          paragraph: { spacing: { before: 240, after: 100 } },
        },
        heading4: {
          run: { font: FONT, size: 22, bold: true, color: "3B3B3B" },
          paragraph: { spacing: { before: 200, after: 80 } },
        },
      },
    },
    sections: [section],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

// ── Несколько ответов одним документом ────────────────────────────────────────
/**
 * Собранное решение.
 *
 * За неделю по одной задаче набирается решение архитектора, вердикты
 * согласующих и записка счетовода — и человек сшивает их в Word руками, то
 * есть делает ровно ту работу, ради избавления от которой платил. Здесь то же
 * самое делает платформа: оглавление, части по порядку, разборы — приложениями
 * в конце, чтобы их было легко отрезать перед отправкой.
 *
 * Части приезжают уже названными: кто и в каком порядке вошёл в документ —
 * решает человек, а не этот файл. Здесь только вёрстка.
 */
export type AssembledPart = {
  /** Название части: строка оглавления и заголовок в тексте */
  title: string;
  /** Ответ агента целиком — «Разбор и вопросы» отделим сами */
  markdown: string;
};

export async function assembledToDocx(
  parts: readonly AssembledPart[],
  meta: DocxMeta,
): Promise<Buffer> {
  const pieces: { title: string; main: RootContent[]; review: RootContent[] }[] = [];
  for (const part of parts) {
    const { main, review } = splitAnswer((await parse(part.markdown)).children);
    // Свой заголовок части мы печатаем сами; если ответ начинается ровно с
    // него — второй раз он не нужен.
    const first = main[0];
    const same =
      first && first.type === "heading" && headingText(first) === part.title.toLowerCase();
    pieces.push({ title: part.title, main: same ? main.slice(1) : main, review });
  }

  const withReview = pieces.filter((p) => p.review.length);

  /**
   * Оглавление — списком, а не полем Word.
   *
   * Настоящее поле оглавления Word показывает пустым, пока читатель не
   * согласится «обновить поля», а половина тех, кому документ перешлют,
   * откроет его в почте или на телефоне и увидит пустую страницу. Список
   * названий виден всегда и печатается как есть.
   */
  const toc: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: "Оглавление", bold: true })],
    }),
    ...pieces.map(
      (p, i) =>
        new Paragraph({
          children: [run(`${i + 1}. `, {}), run(p.title, {})],
          indent: { left: 360, hanging: 260 },
          spacing: { before: 40, after: 40 },
        }),
    ),
    ...(withReview.length
      ? [
          new Paragraph({
            children: [run("Приложения. Разбор и вопросы", { italics: true })],
            indent: { left: 360, hanging: 260 },
            spacing: { before: 40, after: 40 },
          }),
        ]
      : []),
  ];

  const body = pieces.flatMap((p) => [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: p.title, bold: true })],
    }),
    ...blocks(p.main),
  ]);

  const appendix: (Paragraph | Table)[] = withReview.length
    ? [
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: "Приложения. Разбор и вопросы", bold: true })],
        }),
        aside(REVIEW_ASIDE),
        // Каждый разбор подписан своей частью: иначе через неделю не понять,
        // к чему относится вопрос про «пустую графу в третьей таблице».
        ...withReview.flatMap((p) => [
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: `К части «${p.title}»`, bold: true })],
          }),
          ...blocks(p.review),
        ]),
      ]
    : [];

  return pack(meta, [...titleBlocks(meta), ...toc, ...body, ...appendix]);
}

/**
 * Первый осмысленный заголовок ответа — им подписывают часть в оглавлении.
 *
 * «Документ» и «Разбор и вопросы» пропускаем: это служебные части ответа,
 * они одинаковы у всех и в оглавлении ничего не различают.
 */
export async function firstHeadingOf(markdown: string): Promise<string> {
  for (const node of (await parse(markdown)).children) {
    if (node.type !== "heading") continue;
    if (isDocumentHeading(node) || isReviewHeading(node)) continue;
    const text = flatText(node.children);
    if (text) return text;
  }
  return "";
}

const shorten = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/**
 * Имя файла: по нему документ ищут в папке «Загрузки» через неделю и по нему
 * же его находят в почте у того, кому переслали. Поэтому — название задачи
 * и дата, без имени агента: «Никита — посмотри, что тут не так….docx»
 * пересылать неловко.
 */
export function docxFileName(meta: DocxMeta): string {
  const base = shorten(
    meta.task
      .replace(/[\\/:*?"<>|\n\r\t]/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    70,
  );
  return `${base || "Решение"} — ${meta.date}.docx`;
}
