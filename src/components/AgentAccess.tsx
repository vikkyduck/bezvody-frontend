import { useDirectory, type Participant } from "@/lib/directory";
import { agents } from "@/lib/shtab-data";

/**
 * Кому какие агенты открыты. Щелчок открывает или закрывает агента этому
 * человеку — без кнопки «сохранить»: подтверждать нечего, действие и есть
 * результат. Набор у каждого свой, даже если люди из одной компании.
 */
export function AgentAccess({ person }: { person: Participant }) {
  const { toggleAgent } = useDirectory();

  if (agents.length === 0) {
    return (
      <p className="ui-support">
        Каталог пуст: агентов ещё не завели. Как только они появятся, вы сможете открывать их
        отсюда.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {agents.map((a) => {
          const on = person.agentIds.includes(a.id);
          return (
            <button
              key={a.id}
              onClick={() => toggleAgent(person.id, a.id)}
              aria-pressed={on}
              title={a.result}
              className={`btn ui-meta ${on ? "btn-primary" : "btn-glass"}`}
            >
              {on ? "✓ " : ""}
              {a.name}
            </button>
          );
        })}
      </div>
      <p className="ui-support mt-3">
        {person.agentIds.length
          ? `Открыто ${person.agentIds.length} из ${agents.length} — появятся у человека в кабинете сразу.`
          : "Пока не открыт ни один агент: человек войдёт и увидит пустой кабинет."}
      </p>
    </div>
  );
}

/** Контакты одной строкой — чтобы было видно, куда передавать код. */
export function Contacts({ person }: { person: Participant }) {
  const parts: string[] = [];
  if (person.email) parts.push(person.email);
  if (person.telegram) parts.push(`@${person.telegram}`);
  if (!parts.length) return <span className="text-muted-foreground">контакт не записан</span>;
  return <span>{parts.join(" · ")}</span>;
}
