import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Source } from "@/lib/shtab-data";

const EASE = [0.19, 1, 0.22, 1] as const;

/**
 * Первоисточник факта. Раскрывается на месте — проверка не должна
 * уводить со страницы решения.
 */
export function SourceTag({ source }: { source: Source }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground underline decoration-[color:var(--color-line)] decoration-dotted underline-offset-[3px] transition-colors hover:text-foreground"
      >
        <span aria-hidden className="h-[4px] w-[4px] flex-none rounded-full bg-[color:var(--color-line)]" />
        {open ? "Скрыть источник" : "Источник"}
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.dl
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="mt-2.5 space-y-1.5 border-l border-[color:var(--color-line)] pl-3.5 text-[11.5px]">
              <Row term="Система" value={source.system} />
              <Row term="Срез" value={source.slice} />
              <Row term="Объём" value={source.volume} />
              <Row term="Сверено" value={source.checked} />
            </div>
          </motion.dl>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="w-[68px] flex-none text-muted-foreground/70">{term}</dt>
      <dd className="min-w-0 tabular-nums text-muted-foreground">{value}</dd>
    </div>
  );
}
