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
    return <p className="ui-support">Каталог пуст: агентов ещё не завели</p>;
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
          ? `Открыто ${person.agentIds.length} из ${agents.length}`
          : "Пока не открыт ни один агент"}
      </p>
    </div>
  );
}
