import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Ответ агента — это документ, а не реплика в чате: заголовки, таблицы,
 * списки. Без разметки 6-pager читается как сырой текст с палками, ради
 * которого и затевалась вся история.
 *
 * Таблицы кладём в прокручиваемую обёртку: широкая таблица не должна
 * растягивать страницу.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="bv-md text-[13.5px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ node: _node, ...props }) => (
            <div className="my-3 overflow-x-auto">
              <table {...props} />
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
