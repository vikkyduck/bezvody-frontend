import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Ответ агента — это документ, а не реплика в чате: заголовки, таблицы,
 * списки. Без разметки 6-pager читается как сырой текст с палками, ради
 * которого и затевалась вся история.
 *
 * Таблицы кладём в прокручиваемую обёртку: широкая таблица не должна
 * растягивать страницу.
 *
 * Обёрнуто в memo, и это не украшение. Разбор markdown — самая дорогая
 * работа на экране: 6-pager это девять тысяч знаков с таблицами. Пока memo
 * не было, каждая буква, набранная в поле ввода, заново разбирала ВСЕ ответы
 * в окне — под сотню миллисекунд на нажатие, то есть заметная задержка
 * набора. Текст ответа не меняется никогда, поэтому сравнения строки хватает.
 */

/**
 * Голый адрес в тексте — это мусор на полстроки:
 * «https://docs.google.com/spreadsheets/d/1AbC…/edit#gid=0».
 * Показываем то, что человеку нужно для узнавания — откуда ссылка и куда
 * ведёт, — а полный адрес оставляем в подсказке и в самой ссылке.
 * Подписанные ссылки («смотри [выгрузку](…)») не трогаем: там автор уже
 * сказал словами, что это.
 */
function prettyUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    if (!path) return host;
    const tail = path.length > 30 ? `${path.slice(0, 29)}…` : path;
    return `${host}${tail}`;
  } catch {
    // Не разобрался — пусть будет как было, лишь бы не потерять текст.
    return raw;
  }
}

/** Ссылка показана самим адресом (автоссылка), а не подписью. */
function isBareUrl(children: ReactNode, href: string): boolean {
  const text =
    typeof children === "string"
      ? children
      : Array.isArray(children) && children.length === 1 && typeof children[0] === "string"
        ? children[0]
        : null;
  if (!text) return false;
  const bare = text.trim();
  return bare === href || `${bare}/` === href || bare === href.replace(/^https?:\/\//, "");
}

const components: Components = {
  table: ({ node: _node, ...props }) => (
    <div className="my-3 overflow-x-auto">
      <table {...props} />
    </div>
  ),
  // Ссылка уводит из кабинета — открываем соседней вкладкой, чтобы разговор
  // остался на месте. rel обязателен: страница по ссылке чужая, и доступа к
  // нашей вкладке у неё быть не должно.
  a: ({ node: _node, href, children, ...props }) => {
    const url = String(href ?? "");
    const short = isBareUrl(children, url);
    return (
      <a
        {...props}
        href={url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        title={url}
        // Пометка для копирования: при выносе в простой текст сюда надо
        // вернуть полный адрес, иначе из письма ссылка не откроется.
        {...(short ? { "data-short": "" } : {})}
      >
        {short ? prettyUrl(url) : children}
      </a>
    );
  },
};

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="bv-md text-[14.5px] leading-[1.62]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
