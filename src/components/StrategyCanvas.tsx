import { useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { parseStrategyCanvas } from "@/lib/strategy-canvas";

const colors = ["#2563eb", "#ea580c", "#16a34a", "#9333ea", "#dc2626", "#0891b2"];
export function StrategyCanvas({ text }: { text: string }) {
  const { factors, players } = useMemo(() => parseStrategyCanvas(text), [text]);
  if (!factors.length) return null;
  const data = factors.map((f) => ({
    factor: f.factor,
    ...Object.fromEntries(players.map((p, i) => [`p${i}`, f.scores[p] ?? null])),
  }));
  return (
    <section className="card-plain my-5 p-5" aria-label="Стратегическая канва">
      <h2 className="ui-h2">Стратегическая канва «как есть»</h2>
      <p className="ui-support my-2 text-muted-foreground">
        Шкала 0–5. Пробел означает отсутствие оценки. Обоснования, уверенность и источники — в
        ответе Штирлица.
      </p>
      <div style={{ width: "100%", height: 380 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 20, right: 20, bottom: 70, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="factor"
              angle={-20}
              textAnchor="end"
              interval={0}
              height={100}
              tick={{ fontSize: 11 }}
            />
            <YAxis domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} />
            <Tooltip />
            <Legend />
            {players.map((p, i) => (
              <Line
                key={p}
                type="linear"
                dataKey={`p${i}`}
                name={p}
                stroke={colors[i % colors.length]}
                strokeWidth={2}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
