import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bosQuestion } from "../src/lib/bos";
import { bosSystemPrompt } from "../src/lib/server-bos";
import { parseStrategyCanvas } from "../src/lib/strategy-canvas";
import { sourceLink, anthropicText } from "../src/lib/research-sources";
import { documentKey } from "../src/lib/server-postgres";

const prompt = (name: string) => readFileSync(`deploy/bos-prompts/${name}`, "utf8");
test("all four original Kat modes receive actual form context and no unresolved template fields", () => {
  const cfg = {
    prompt: prompt("kat-main.txt"),
    bosModes: Object.fromEntries(["1", "2", "3"].map((m) => [m, prompt(`kat-mode-${m}.txt`)])),
  };
  for (const mode of ["main", "1", "2", "3"]) {
    const question = bosQuestion("kat", mode, {
      industry: "Учебный рынок",
      main_company: "Компания А",
      team_factors: "Цена\nСрок внедрения",
    });
    const result = bosSystemPrompt("kat", cfg, [], question)!;
    assert.match(result, /Учебный рынок/);
    if (mode !== "3") assert.match(result, /Компания А/);
    if (mode === "3") assert.match(result, /Цена\nСрок внедрения/);
    assert.doesNotMatch(result, /\{[a-zA-Z_0-9]+\}/);
    if (mode !== "main") assert.ok(result.startsWith(cfg.bosModes[mode]!.split("{industry}")[0]!));
  }
});
test("Stirlitz's prompt keeps source methodology and reuses context on followups", () => {
  const cfg = { prompt: prompt("stirlitz-main.txt") };
  const question = bosQuestion("stirlitz", "main", {
    industry: "Учебный рынок",
    main_company: "А",
    alternatives_list: "Б\nВ",
    team_factors: "Цена\nСкорость",
  });
  const result = bosSystemPrompt(
    "stirlitz",
    cfg,
    [{ id: "1", from: "user", text: question, at: "" }],
    "Добавьте источники",
  )!;
  assert.match(result, /Учебный рынок/);
  assert.match(result, /\| Б \| \[0–5\]/);
  assert.doesNotMatch(result, /\{[a-zA-Z_0-9]+\}/);
  assert.match(result, /высокая цена = высокая оценка/);
  assert.equal(bosSystemPrompt("architect", cfg, [], "test"), null);
});
test("canvas preserves zero and missing values and rejects out of range scores", () => {
  const parsed = parseStrategyCanvas(
    "### Фактор 1: Цена\n| А | 0 | низкая |\n| Б | 5 | высокая |\n### Фактор 2: Срок\n| А | нет данных | низкая |\n| Б | 4 | высокая |\n| В | 5.9 | низкая |\n## Ключевые наблюдения\n| Г | 3 | высокая |",
  );
  assert.deepEqual(parsed.players, ["А", "Б"]);
  assert.equal(parsed.factors[0]!.scores["А"], 0);
  assert.equal(parsed.factors[1]!.scores["А"], undefined);
  assert.equal(parsed.factors[1]!.scores["Б"], 4);
});
test("research citations remain clickable and reject executable URL schemes", () => {
  assert.equal(sourceLink("x", "javascript:alert(1)"), "");
  assert.match(
    anthropicText([
      {
        type: "text",
        text: "Факт",
        citations: [{ url: "https://example.com/source", title: "Источник" }],
      },
    ]),
    /\[Источник\]\(<https:\/\/example.com\/source>\)/,
  );
});
test("database mapping excludes credentials and paths outside the data directory", () => {
  process.env["BV_DATABASE_URL"] = "postgresql://unused";
  process.env["BV_DATA_DIR"] = "/tmp/nowater-test";
  assert.equal(documentKey("/tmp/nowater-test/agents.json"), "agents.json");
  assert.equal(documentKey("/tmp/nowater-test/windows/p1.json"), "windows/p1.json");
  assert.equal(documentKey("/tmp/nowater-test/secrets.json"), null);
  assert.equal(documentKey("/tmp/elsewhere.json"), null);
  delete process.env["BV_DATABASE_URL"];
  assert.equal(documentKey("/tmp/nowater-test/agents.json"), null);
});
