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
import type { Root, RootContent, PhrasingContent, TableCell as MdTableCell } from "mdast";

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
                  node.children[0] && node.children[0].type === "paragraph" ? node.children[0].children : [],
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
            children: node.value.split("\n").flatMap((line, i) => (i ? [new TextRun({ break: 1 }), run(line, { code: true })] : [run(line, { code: true })])),
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

// ── Документ целиком ──────────────────────────────────────────────────────────

export type DocxMeta = {
  /** Имя агента — он автор разбора */
  agent: string;
  /** Кому он его написал */
  person: string;
  company: string;
  /** Вопрос, с которого всё началось */
  question: string;
  date: string;
};

export async function answerToDocx(markdown: string, meta: DocxMeta): Promise<Buffer> {
  const { fromMarkdown } = await import("mdast-util-from-markdown");
  const { gfm } = await import("micromark-extension-gfm");
  const { gfmFromMarkdown } = await import("mdast-util-gfm");

  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  }) as Root;

  const body = blocks(tree.children);

  const head: (Paragraph | Table)[] = [
    new Paragraph({
      children: [
        new TextRun({ text: `Платформа «Без Воды» · ${meta.agent}`, color: MUTED, size: 18, characterSpacing: 20 }),
      ],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [new TextRun({ text: shorten(meta.question, 110), bold: true, size: 34 })],
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
      spacing: { after: 260 },
    }),
    new Paragraph({
      children: [new TextRun({ text: "Вопрос", bold: true, size: 18, color: MUTED, characterSpacing: 20 })],
      spacing: { after: 60 },
    }),
    new Paragraph({
      children: [new TextRun({ text: meta.question, italics: true, color: "3B3B3B" })],
      indent: { left: 240 },
      border: { left: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 12 } },
      spacing: { after: 280 },
    }),
  ];

  const section: ISectionOptions = {
    properties: {
      page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } },
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: `${meta.agent} · ${meta.date} · `, color: MUTED, size: 16 }),
              new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 16 }),
            ],
          }),
        ],
      }),
    },
    children: [...head, ...body],
  };

  const doc = new Document({
    creator: `Платформа «Без Воды» · ${meta.agent}`,
    title: shorten(meta.question, 110),
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

const shorten = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** Имя файла: по нему документ ищут в папке «Загрузки» через неделю. */
export function docxFileName(meta: DocxMeta): string {
  const base = shorten(meta.question.replace(/[\\/:*?"<>|\n\r\t]/g, " ").replace(/\s+/g, " ").trim(), 60);
  return `${meta.agent} — ${base || "разбор"} — ${meta.date}.docx`;
}
