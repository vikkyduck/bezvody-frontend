import { memo } from "react";
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
const components: Components = {
  table: ({ node: _node, ...props }) => (
    <div className="my-3 overflow-x-auto">
      <table {...props} />
    </div>
  ),
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
