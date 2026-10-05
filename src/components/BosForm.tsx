import { useState } from "react";
import { BOS_FIELDS, BOS_MODES, bosQuestion } from "@/lib/bos";

export function BosForm({
  agentId,
  disabled,
  started,
  onPrepare,
}: {
  agentId: string;
  disabled: boolean;
  started: boolean;
  onPrepare: (text: string) => void;
}) {
  const [mode, setMode] = useState("main");
  const [values, setValues] = useState<Record<string, string>>({});
  const valid =
    Boolean(values["industry"]?.trim() && values["main_company"]?.trim()) &&
    (agentId !== "kat" || !["2", "3"].includes(mode) || Boolean(values["team_factors"]?.trim()));
  return (
    <details open={!started} className="card-plain mb-5 p-5">
      <summary className="ui-h2 cursor-pointer">Данные для анализа</summary>
      <p className="ui-support my-3 text-muted-foreground">
        {agentId === "kat"
          ? "Заполните отрасль и компанию. Остальные поля помогут учесть особенности вашей задачи."
          : "Укажите отрасль и компанию. Добавьте факторы и конкурентов или приложите проверенный командой результат Кэт в блоке материалов."}
      </p>
      {agentId === "kat" && (
        <label className="ui-support mb-4 block">
          Режим Кэт
          <select
            aria-label="Режим Кэт"
            className="ui-body mt-1 block w-full rounded-lg border bg-background p-3"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            {BOS_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {BOS_FIELDS.filter(
          ([key]) =>
            !(agentId === "kat" && key === "team_context") &&
            !(agentId === "stirlitz" && key === "business_model"),
        ).map(([key, label]) => (
          <label key={key} className="ui-support block">
            {label}
            {["industry", "main_company"].includes(key) ? " *" : ""}
            <textarea
              aria-label={label}
              rows={["industry", "main_company"].includes(key) ? 1 : 3}
              value={values[key] ?? ""}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
              className="ui-body mt-1 block w-full rounded-lg border bg-background p-3"
            />
          </label>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-primary mt-4 disabled:opacity-40"
        disabled={disabled || !valid}
        onClick={() => onPrepare(bosQuestion(agentId, mode, values))}
      >
        Начать анализ
      </button>
    </details>
  );
}
