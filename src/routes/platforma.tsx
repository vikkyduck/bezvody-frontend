import { createFileRoute } from "@tanstack/react-router";
import { Landing } from "@/components/Landing";

export const Route = createFileRoute("/platforma")({
  head: () => ({
    meta: [
      { title: "NOWATER.TECH — управленческие решения на ИИ-агентах" },
      {
        name: "description",
        content:
          "Агенты собирают данные, проверяют источники и спорят с выводами, готовя документ к защите. Первая выдача на пятый день.",
      },
      { property: "og:title", content: "NOWATER.TECH — управленческие решения на ИИ-агентах" },
      {
        property: "og:description",
        content:
          "Платформа подготовки управленческих решений: агенты, методолог, руководитель. Первая выдача на пятый день.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});
