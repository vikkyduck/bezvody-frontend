/* ============================================================================
   core.tsx — ядро сайта на дизайн-системе 2.4 «Сухой остаток».
   Материалы системы: жидкое стекло (линза + перелив), графическая сцена из
   узлов, бумага и хром. Капли, сферы и волны удалены — брендбук запрещает
   воду прямо, даже «по теме названия».
   ========================================================================== */
import {
  useRef,
  useState,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
  type CSSProperties,
} from "react";
import { motion, AnimatePresence, MotionConfig } from "motion/react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowDown,
  Plus,
  Check,
  ExternalLink,
  Calendar,
} from "lucide-react";

export { motion, AnimatePresence };
export { ArrowUpRight, ArrowRight, ArrowDown, Plus, Check, ExternalLink, Calendar };
export { useRef, useState, useEffect };
export type { ReactNode, CSSProperties };

const CALM_KEY = "bv-calm-motion";
const listeners = new Set<() => void>();
let calmState = false;

function readInitialCalm(): boolean {
  if (typeof window === "undefined") return false;
  const stored = window.localStorage.getItem(CALM_KEY);
  if (stored === "1") return true;
  if (stored === "0") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function emit() {
  listeners.forEach((l) => l());
}

function setCalm(v: boolean) {
  calmState = v;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CALM_KEY, v ? "1" : "0");
    document.documentElement.dataset["calm"] = v ? "true" : "false";
  }
  emit();
}

function subscribeCalm(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useCalm(): [boolean, (v: boolean) => void] {
  // hydrate lazily on first client render
  const value = useSyncExternalStore(
    subscribeCalm,
    () => calmState,
    () => false,
  );
  useEffect(() => {
    const initial = readInitialCalm();
    if (initial !== calmState) setCalm(initial);
    else document.documentElement.dataset["calm"] = calmState ? "true" : "false";
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => {
      // only follow system if user hasn't explicitly opted
      if (window.localStorage.getItem(CALM_KEY) === null) setCalm(e.matches);
    };
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);
  return [value, setCalm];
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mq.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, [query]);
  return matches;
}

/* --------- Активный сценарий: карточки Hero ↔ табы секции Scenarios --------- */
/* Секция Scenarios регистрирует свой setActive здесь при монтировании.        */
/* Состояние остаётся локальным useState — это важно: с useSyncExternalStore    */
/* AnimatePresence(mode="wait") зависал (старый блок не размонтировался).        */

/* Микро-цели Яндекс Метрики. Имена целей (создать в интерфейсе Метрики как
   «JavaScript-событие»): scenario_selected, form_started, chip_toggled, lead_sent. */
export function ymGoal(goal: string, params?: Record<string, unknown>) {
  const w = window as unknown as { ym?: (...a: unknown[]) => void; YM_ID?: number };
  if (w.ym && w.YM_ID) w.ym(w.YM_ID, "reachGoal", goal, params);
}

/* ----------------------------- Логотип и метки --------------------------- */
/* Срез — фирменный приём: горизонтальный пропил, «лишнее отсечено».
   В логотипе он живёт на слове ВОДЫ. Один срез на макет — поэтому в
   заголовках страниц приём не повторяется. */

export function StencilLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`inline-flex flex-col ${className}`}>
      {/* Логотип остаётся на Unbounded даже после перевода типографики
          на новостной строй 05.08.2026: это знак, а не набор. */}
      <span className="font-logo text-[1.6em] font-medium tracking-[-0.02em]">
        БЕЗ <span className="cut">ВОДЫ</span>
      </span>
      <span className="font-logo text-[0.52em] font-medium tracking-[-0.01em] mt-1.5">
        withoutwater
      </span>
    </div>
  );
}

/* Надзаголовок секции: номер Unbounded, волосяная линия, капитель Golos. */
export function SectionLabel({ n, children }: { n?: string; children: ReactNode }) {
  return (
    <div
      data-seclabel
      className="t-eyebrow flex items-center gap-3 text-[color:var(--color-text-secondary)]"
    >
      <Stencil n={n ?? "00"} active className="text-[color:var(--color-accent)]" />
      <span className="h-px w-10 bg-[color:var(--color-line)]" />
      <span>{children}</span>
    </div>
  );
}

/* ------------------------- Линза преломления ----------------------------- */
/* Один SVG-фильтр обслуживает элементы любого размера: карта смещения
   растягивается под элемент за счёт preserveAspectRatio="none". Разметка
   кладётся один раз в начало страницы (см. PageShell). */

const LENS_MAP =
  "data:image/svg+xml;utf8," +
  "<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' preserveAspectRatio='none'>" +
  "<defs>" +
  "<linearGradient id='x' x1='0' x2='1'>" +
  "<stop offset='0' stop-color='rgb(255,128,0)'/>" +
  "<stop offset='0.34' stop-color='rgb(128,128,0)'/>" +
  "<stop offset='0.66' stop-color='rgb(128,128,0)'/>" +
  "<stop offset='1' stop-color='rgb(0,128,0)'/>" +
  "</linearGradient>" +
  "<linearGradient id='y' x1='0' y1='0' x2='0' y2='1'>" +
  "<stop offset='0' stop-color='rgb(0,255,0)'/>" +
  "<stop offset='0.34' stop-color='rgb(0,128,0)'/>" +
  "<stop offset='0.66' stop-color='rgb(0,128,0)'/>" +
  "<stop offset='1' stop-color='rgb(0,0,0)'/>" +
  "</linearGradient>" +
  "</defs>" +
  "<rect width='100' height='100' fill='url(%23x)'/>" +
  "<rect width='100' height='100' fill='url(%23y)' style='mix-blend-mode:screen'/>" +
  "</svg>";

/* Определение слабого устройства: мало ядер/памяти, экономия трафика или
   отсутствие мыши. На таких устройствах SVG-линза (feDisplacementMap на
   backdrop) стоит слишком дорого — переходим на обычный blur(). */
export function useLowPower(): boolean {
  const [low, setLow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const nav = window.navigator as Navigator & {
      deviceMemory?: number;
      connection?: { saveData?: boolean };
    };
    const cores = nav.hardwareConcurrency ?? 8;
    const mem = nav.deviceMemory ?? 8;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const narrow = window.matchMedia("(max-width: 767px)").matches;
    const saveData = nav.connection?.saveData === true;
    const value = cores <= 4 || mem <= 4 || saveData || coarse || narrow;
    setLow(value);
    document.documentElement.dataset["lowpower"] = value ? "true" : "false";
  }, []);
  return low;
}

export function LensFilter() {
  const lowPower = useLowPower();
  const [calm] = useCalm();
  // На слабых устройствах и в calm-режиме линзу не монтируем вовсе:
  // стекло рендерится через обычный blur() fallback (см. styles.css).
  if (lowPower || calm) return null;
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <filter
        id="bv-lens"
        x="-25%"
        y="-25%"
        width="150%"
        height="150%"
        colorInterpolationFilters="sRGB"
      >
        <feImage preserveAspectRatio="none" result="map" href={LENS_MAP} />
        <feDisplacementMap
          in="SourceGraphic"
          in2="map"
          scale="38"
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  );
}

/* --------------------------- Движок курсора ------------------------------ */
/* Один обработчик на страницу: считает положение курсора внутри каждого
   видимого элемента и ставит переменные. Все состояния остаются в стилях.
   Не запускается при prefers-reduced-motion и на устройствах без мыши. */

export function GlassPointer() {
  const [calm] = useCalm();
  const hasPointer = useMediaQuery("(pointer: fine) and (hover: hover)");
  useEffect(() => {
    if (calm) return;
    // Инициализируем только при наличии мыши: точный указатель + hover.
    // На touch-устройствах (mobile / планшеты без мыши) эффект не стартует.
    if (!hasPointer) return;

    const SEL = ".lg, .btn-primary, .btn-secondary, .btn-glass, .btn-invert";
    const bound = new WeakSet<HTMLElement>();

    const bind = (el: HTMLElement) => {
      if (bound.has(el)) return;
      bound.add(el);
      let raf = 0;
      let px = 50;
      let py = 0;
      const isBtn = el.classList.contains("btn");

      const apply = () => {
        raf = 0;
        el.style.setProperty("--mx", px.toFixed(1) + "%");
        el.style.setProperty("--my", py.toFixed(1) + "%");
        /* угол световой полосы идёт за курсором — стекло ловит свет */
        el.style.setProperty("--sheen", (90 + (px - 50) * 1.1).toFixed(1) + "deg");
        const dx = px / 100 - 0.5;
        const dy = py / 100 - 0.5;
        el.style.setProperty("--tx", (-dy * 1.4).toFixed(2) + "deg");
        el.style.setProperty("--ty", (dx * 1.4).toFixed(2) + "deg");
      };

      el.addEventListener(
        "pointermove",
        (e) => {
          const r = el.getBoundingClientRect();
          if (!r.width) return;
          px = ((e.clientX - r.left) / r.width) * 100;
          py = ((e.clientY - r.top) / r.height) * 100;
          el.style.setProperty("--lg-glow", isBtn ? "0.52" : "0.62");
          if (!raf) raf = requestAnimationFrame(apply);
        },
        { passive: true },
      );
      el.addEventListener("pointerleave", () => {
        el.style.setProperty("--lg-glow", isBtn ? "0" : "0.14");
        el.style.setProperty("--tx", "0deg");
        el.style.setProperty("--ty", "0deg");
      });
    };

    const scan = () => document.querySelectorAll<HTMLElement>(SEL).forEach(bind);
    scan();

    /* React дорисовывает карточки по мере появления в вьюпорте — следим
       за деревом, иначе часть стекла останется без перелива. */
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [calm, hasPointer]);
  return null;
}

/* --------------------- Графическая сцена: узлы и блобы -------------------- */
/* Стекло допустимо только там, где под ним есть что преломлять. Сцена —
   это подложка: сетка узлов (язык системных аналитиков) плюс мягкие пятна
   розового стекла и хрома. Никаких капель и сфер. */

/* Узлы — графическая сцена под стекло: одна локальная композиция, а не
   паттерн-обои. Живёт в правой части секции, гаснет к тексту. Круги
   остаются круглыми: viewBox без растяжения. */

const NODES: [number, number, number, boolean][] = [
  // x, y, r, акцентный
  [16, 30, 2.4, false],
  [42, 14, 3.0, true],
  [62, 40, 2.2, false],
  [30, 62, 2.6, false],
  [54, 84, 2.2, false],
  [82, 26, 2.4, false],
  [86, 66, 3.0, true],
  [70, 108, 2.2, false],
];
const EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [2, 5],
  [5, 6],
  [6, 7],
  [4, 7],
  [0, 3],
  [1, 5],
];

export function NodeScene({
  className = "",
  opacity = 0.5,
}: {
  className?: string;
  opacity?: number;
}) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  if (isMobile) return null;
  return (
    <svg
      className={`pointer-events-none absolute right-[-4%] top-1/2 hidden h-[min(78%,560px)] -translate-y-1/2 md:block ${className}`}
      viewBox="0 0 100 120"
      fill="none"
      aria-hidden
      style={{
        opacity,
        WebkitMaskImage: "radial-gradient(70% 70% at 62% 50%, #000 30%, transparent 82%)",
        maskImage: "radial-gradient(70% 70% at 62% 50%, #000 30%, transparent 82%)",
      }}
    >
      {EDGES.map(([a, b]) => (
        <line
          key={`${a}-${b}`}
          x1={NODES[a]![0]}
          y1={NODES[a]![1]}
          x2={NODES[b]![0]}
          y2={NODES[b]![1]}
          stroke="currentColor"
          strokeWidth="0.35"
          opacity="0.55"
        />
      ))}
      {NODES.map(([x, y, r, on], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r={r * 0.5}
          fill={on ? "var(--color-accent)" : "currentColor"}
          opacity={on ? 0.85 : 0.6}
        />
      ))}
    </svg>
  );
}

/* Мягкое пятно материала под стеклом: розовое стекло или хром. */
export function Blob({
  className = "",
  tone = "rose",
  size = 420,
}: {
  className?: string;
  tone?: "rose" | "chrome";
  size?: number;
}) {
  return (
    <div
      aria-hidden
      className={`stage__blob stage__blob--${tone} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/* Сцена под стекло: сетка узлов плюс мягкие пятна материала. Стекло
   допустимо только там, где под ним есть что преломлять (брендбук, разд. 7). */
export function Scene({
  nodes = true,
  blobs = [],
  nodeClass = "text-[color:var(--color-steel)]",
}: {
  nodes?: boolean;
  blobs?: { className: string; tone?: "rose" | "chrome"; size?: number }[];
  nodeClass?: string;
}) {
  const [calm] = useCalm();
  return (
    <div className="stage__bg" aria-hidden>
      {nodes && <NodeScene className={nodeClass} />}
      {!calm &&
        blobs.map((b, i) => (
          <Blob
            key={i}
            className={b.className}
            {...(b.tone ? { tone: b.tone } : {})}
            {...(b.size ? { size: b.size } : {})}
          />
        ))}
    </div>
  );
}

/* ------------------------------ GlassCard -------------------------------- */
/* Обёртка над материалом .lg. Стекло кладётся только на графическую сцену;
   на ровном фоне используется .card — бумажная поверхность. */

export function GlassCard({
  children,
  className = "",
  dark = false,
  ink = false,
  interactive = false,
  as: Tag = "div",
  style,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  dark?: boolean;
  ink?: boolean;
  interactive?: boolean;
  as?: any;
  style?: CSSProperties;
  [k: string]: any;
}) {
  const tone = dark ? "lg-dark" : ink ? "lg-ink" : "";
  return (
    <Tag
      className={`lg ${tone} ${interactive ? "lg-interactive" : ""} rounded-md ${className}`}
      style={style}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/* Бумажная карточка — там, где под стеклом нечего преломлять. */
export function PaperCard({
  children,
  className = "",
  as: Tag = "div",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: any;
  [k: string]: any;
}) {
  return (
    <Tag className={`card ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

/* Парадный разделитель с двумя узлами — не чаще одного на экран. */
export function NodeDivider({ className = "" }: { className?: string }) {
  return (
    <div className={`node-divider ${className}`} aria-hidden>
      <i />
      <i />
    </div>
  );
}

/* ==========================================================================
   Элементы фирменного стиля из брендбука: кот-росчерк, подчерк, стрелка
   от руки, маркеры-узлы, трафаретная нумерация, линейные иконки.
   Все графемы рисуются одним росчерком: только контур, скруглённые концы,
   без заливок и «мультяшности».
   ========================================================================== */

/* Кот — талисман бюро. Один кот на носитель; только контур 2–3,5 px. */
export function CatMark({
  className = "",
  strokeWidth = 2.2,
}: {
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 140 120"
      fill="none"
      aria-hidden
      className={`pointer-events-none ${className}`}
    >
      {/* тело: спина, уши, морда, грудь, лапа — одна непрерывная кривая */}
      <path
        d="M48 106c-6-22-2-44 26-58l6-22 11 18c13-3 25 7 27 22 1.6 11-3.4 15-7.6 19.6-4 4.4-4 10.4-1 20.4"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M48 106h61.4"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {/* хвост: свободный росчерк с петлёй */}
      <path
        d="M48 106c-14 4-30 1-32-10-1.6-9 10-14 15-7 4.6 6.4-1 13.6-8 12"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* Росчерк-подчерк: живая кривая под словом, никогда не прямая линия. */
export function Swash({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`relative inline-block ${className}`}>
      <span className="relative z-[1]">{children}</span>
      <svg
        viewBox="0 0 200 12"
        preserveAspectRatio="none"
        aria-hidden
        className="absolute inset-x-0 -bottom-[0.18em] h-[0.28em] w-full text-[color:var(--color-accent)]"
      >
        <path
          d="M2 8.4C34 3.6 72 2.4 104 5.2c30 2.6 62 3.4 94-1.6"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  );
}

/* Стрелка от руки — росчерк с двумя усами. */
export function HandArrow({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 24" fill="none" aria-hidden className={className}>
      <path
        d="M2 17.5C14 8.5 34 3.5 60 6.5"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M50 2.5 60 6.5 53 14"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/* Точка-узел вместо буллита: активный узел — Пыльная роза с ореолом. */
export function NodeBullet({
  active = false,
  className = "",
}: {
  active?: boolean;
  className?: string;
}) {
  return (
    <span aria-hidden className={`node-dot ${active ? "node-dot-active" : ""} ${className}`} />
  );
}

/* Список с маркерами-узлами — единый приём для всех перечислений. */
export function NodeList({
  items,
  className = "",
  itemClassName = "",
  divided = false,
  accentFirst = true,
}: {
  items: ReactNode[];
  className?: string;
  itemClassName?: string;
  divided?: boolean;
  /* false — когда список продолжает соседний (вторая колонка):
     акцентный узел только у настоящего первого пункта */
  accentFirst?: boolean;
}) {
  return (
    <ul
      className={`${divided ? "divide-y divide-border border-y border-[color:var(--color-line)]" : "space-y-2.5"} ${className}`}
    >
      {items.map((it, i) => (
        <li
          key={i}
          className={`flex items-start gap-3 ${divided ? "py-3.5" : ""} ${itemClassName}`}
        >
          <NodeBullet active={accentFirst && i === 0} className="mt-[0.55em]" />
          <span className="t-body flex-1">{it}</span>
        </li>
      ))}
    </ul>
  );
}

/* Номер-трафарет: Unbounded, без скобок и точек. */
export function Stencil({
  n,
  active = false,
  className = "",
}: {
  n: number | string;
  active?: boolean;
  className?: string;
}) {
  const label = typeof n === "number" ? String(n).padStart(2, "0") : n;
  return (
    <span data-active={active} className={`stencil ${className}`}>
      {label}
    </span>
  );
}

/* Линейные иконки: один росчерк, петля вместо точки. 20/24/32 px. */
export type IconName =
  | "graph"
  | "checklist"
  | "term"
  | "team"
  | "metric"
  | "standard"
  | "process"
  | "insight"
  | "quality"
  | "handoff";

const ICON_PATHS: Record<IconName, ReactNode> = {
  graph: (
    <>
      <path d="M3 17l5-6 4 3 4-8 5 4" />
      <circle cx="8" cy="11" r="1.3" />
      <circle cx="16" cy="6" r="1.3" />
    </>
  ),
  checklist: (
    <>
      <path d="M4 6h9M4 12h9M4 18h9" />
      <path d="M17 5.5l1.6 1.6L21.5 4" />
      <path d="M17 11.5l1.6 1.6L21.5 10" />
    </>
  ),
  term: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7v5.4l3.4 2" />
    </>
  ),
  team: (
    <>
      <circle cx="9" cy="8.5" r="2.6" />
      <circle cx="16.5" cy="9.5" r="2" />
      <path d="M3.8 18c.6-3 2.7-4.6 5.2-4.6s4.6 1.6 5.2 4.6" />
      <path d="M16.2 13.6c2.1.2 3.5 1.6 4 4.4" />
    </>
  ),
  metric: (
    <>
      <path d="M4 4v16h16" />
      <path d="M7.5 15l3.5-4.5 3 2.5L19 7" />
      <circle cx="19" cy="7" r="1.2" />
    </>
  ),
  standard: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8.2l1.5 2.7 3 .5-2.2 2.1.5 3-2.8-1.5-2.8 1.5.5-3L7.5 11.4l3-.5z" />
    </>
  ),
  process: (
    <>
      <path d="M20 12a8 8 0 1 1-3.2-6.4" />
      <path d="M20 4.5V9h-4.4" />
    </>
  ),
  insight: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  quality: (
    <>
      <path d="M12 3.4l7 2.6v6c0 4.4-3 7.6-7 8.6-4-1-7-4.2-7-8.6V6z" />
      <path d="M9 12.2l2.2 2.2L15.4 10" />
    </>
  ),
  handoff: (
    <>
      <path d="M4 17c4-1 6.5-4 8.5-9" />
      <path d="M13 16l6-6" />
      <path d="M15.6 8.6H20V13" />
      <circle cx="4.5" cy="17.2" r="1.3" />
    </>
  ),
};

export function LineIcon({
  name,
  className = "h-6 w-6",
  strokeWidth = 1.7,
}: {
  name: IconName;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

/* Единый сценарий появления секций: снизу, y 16, 0.45s, stagger 0.05 */
export const REVEAL_EASE = [0.2, 0.8, 0.2, 1] as const;
export const REVEAL_VIEWPORT = { once: true, amount: 0.1, margin: "0px 0px -10% 0px" } as const;
export function reveal(index = 0) {
  return {
    initial: { opacity: 0, y: 12 },
    whileInView: { opacity: 1, y: 0 },
    viewport: REVEAL_VIEWPORT,
    transition: { delay: index * 0.04, duration: 0.32, ease: REVEAL_EASE },
  };
}

export function RevealHeading({
  children,
  className = "",
  as: Tag = "h2",
}: {
  children: ReactNode;
  className?: string;
  as?: any;
}) {
  const [calm] = useCalm();
  const MotionTag = motion[Tag as "h2"] as any;
  if (calm) {
    return <Tag className={className}>{children}</Tag>;
  }
  return (
    <MotionTag
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.1, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.45, ease: REVEAL_EASE }}
      className={className}
    >
      {children}
    </MotionTag>
  );
}

export function Field({
  label,
  name,
  placeholder,
  dark = false,
  error,
  onBlur,
  onInput,
  inputRef,
  required = false,
  autoComplete,
}: {
  label: string;
  name: string;
  placeholder: string;
  dark?: boolean;
  error?: string | null;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  onInput?: React.FormEventHandler<HTMLInputElement>;
  inputRef?: React.Ref<HTMLInputElement>;
  required?: boolean;
  autoComplete?: string;
}) {
  /* id с префиксом: без него input name="contact" конфликтовал бы с
     id="contact" у секции формы, и label ссылался бы на секцию. */
  const id = `f-${name}`;
  const errId = `${id}-error`;
  const base = dark
    ? "min-h-11 w-full rounded-sm border bg-white/5 px-4 py-3 t-body text-[color:var(--color-text-inverse)] outline-none transition placeholder:text-[color:var(--color-text-inverse-2)]/50"
    : "min-h-11 w-full rounded-sm border bg-[color:var(--color-surface)] px-4 py-3 t-body text-[color:var(--color-text-primary)] outline-none transition placeholder:text-[color:var(--color-steel)]";
  const state = error
    ? "border-[color:var(--color-accent)] focus:border-[color:var(--color-accent)]"
    : dark
      ? "border-[color:var(--color-line-dark)] focus:border-[color:var(--color-accent-glass)]"
      : "border-[color:var(--color-line)] focus:border-[color:var(--color-accent)]";
  return (
    <div>
      <label
        htmlFor={id}
        className={`t-label mb-2 block ${
          dark
            ? "text-[color:var(--color-text-inverse-2)]"
            : "text-[color:var(--color-text-secondary)]"
        }`}
      >
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        name={name}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onBlur={onBlur}
        onInput={onInput}
        required={required}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined}
        className={`${base} ${state}`}
      />
      {error && (
        <p
          id={errId}
          role="alert"
          className={`mt-2 flex items-start gap-1.5 t-caption ${
            dark ? "text-[color:var(--color-accent-glass)]" : "text-[color:var(--color-accent)]"
          }`}
        >
          <span aria-hidden className="mt-[0.15em] leading-none">
            •
          </span>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

/* --------------------------------- Page --------------------------------- */

/* Переключатель «Меньше анимаций» удалён из интерфейса (решение Виктории
   03.08 — «исторически остался»). Автоматика жива: useCalm стартует от
   prefers-reduced-motion, calm-режим по-прежнему гасит framer и линзу. */

export function CookieBar() {
  const [show, setShow] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    try {
      if (!window.localStorage.getItem("bv-cookie-ok")) setShow(true);
    } catch {
      setShow(true);
    }
  }, []);
  /* Плашка фиксирована у нижней кромки и на мобильном перекрывала последнюю
     строку карточек. Пока она видна — резервируем под неё место в потоке. */
  useEffect(() => {
    const el = document.documentElement;
    if (show) el.setAttribute("data-cookie-open", "");
    else el.removeAttribute("data-cookie-open");
    return () => el.removeAttribute("data-cookie-open");
  }, [show]);
  const accept = () => {
    try {
      window.localStorage.setItem("bv-cookie-ok", "1");
    } catch {}
    setShow(false);
  };
  if (!mounted || !show) return null;

  /* Раньше вся полоса была <div role="button"> без tabindex: с клавиатуры её
     нельзя было закрыть в принципе, а текст не сообщал, что клик = согласие.
     Теперь полоса — обычный текст со ссылкой, а закрывает её настоящая кнопка. */
  return (
    <div
      data-cookie-bar
      className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-[color:var(--color-line)] bg-[color:var(--color-bg-primary)] px-4 py-2 text-center"
    >
      <span className="t-caption text-[color:var(--color-text-secondary)]">
        Cookie и Яндекс Метрика ·{" "}
        <a
          href="/politics_pd"
          className="underline underline-offset-2 hover:text-[color:var(--color-text-primary)]"
        >
          политика
        </a>
      </span>
      <button
        type="button"
        onClick={accept}
        className="rounded-sm border border-[color:var(--color-line)] px-3 py-1 t-eyebrow text-[color:var(--color-text-primary)] transition-colors duration-[160ms] hover:border-[color:var(--color-steel)] hover:bg-[color:var(--color-bg-secondary)]"
      >
        Понятно
      </button>
    </div>
  );
}
/* ------------------------- Nav (меню по ТЗ v3) --------------------------- */
/* Четыре пункта обычными словами + одна кнопка действия. Кнопка везде одна:
   «Разбор задачи за 30 минут». */

export const NAV_LINKS: [string, string][] = [
  ["Задачи и решения", "/tasks"],
  ["Кейсы", "/cases"],
  ["Как мы работаем", "/how-we-work"],
  ["О нас", "/team"],
];

/* Второй уровень: раньше жил в футере, теперь — в меню. */
export const NAV_SECONDARY: [string, string][] = [
  ["Бизнес-эффект", "/business-effect"],
  ["Отзывы", "/reviews"],
  ["Частые вопросы", "/faq"],
  ["Контакты", "/contacts"],
];

export const CTA_LABEL = "Разбор задачи за 30 минут";

/* Личный кабинет клиента (FinanceDuck). Пока указывает на исторический адрес:
   после активации app.withoutwater.ru скрипт finance-duck-activate на сервере
   сам заменит URL в задеплоенном сайте (sed по этой строке-литералу); тогда же
   поменять и здесь. */
export const LK_URL = "https://fin-dohod.ru";
export const LK_LABEL = "Личный кабинет";

/* Ссылка CTA: на главной — якорь формы, на остальных страницах — /contacts. */
export function ctaHref(path: string): string {
  return path === "/" ? "#contact" : "/contacts#form";
}

export function Nav({ path = "/" }: { path?: string }) {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  /* На главной первый экран уже несёт главную кнопку: в шапке до ухода hero
     держим вторичный вес, чтобы не было двух primary одновременно. */
  const [pastHero, setPastHero] = useState(path !== "/");
  const headRef = useRef<HTMLElement | null>(null);
  const [navH, setNavH] = useState(64);

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
      setPastHero(path !== "/" || window.scrollY > window.innerHeight * 0.6);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [path]);

  const menuRef = useRef<HTMLDivElement | null>(null);
  const burgerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  /* Клавиатура: Esc закрывает меню и возвращает фокус на кнопку,
     Tab не выходит за пределы открытой панели. */
  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLElement>("a, button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        burgerRef.current?.focus();
        return;
      }
      if (e.key !== "Tab" || !menuRef.current) return;
      const items = Array.from(
        menuRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
      ).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const edge = e.shiftKey ? items[0] : items[items.length - 1];
      if (document.activeElement === edge) {
        e.preventDefault();
        (e.shiftKey ? items[items.length - 1] : items[0])?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    const measure = () => setNavH(headRef.current?.getBoundingClientRect().height ?? 64);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  return (
    <header
      ref={headRef}
      className="sticky top-0 z-50 border-b border-[color:var(--color-line)] bg-[color:var(--color-bg-primary)]"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3 md:px-8 md:py-4">
        <a
          href="/"
          className="flex items-center gap-2 text-[color:var(--color-text-primary)] shrink-0"
          aria-label="БЕЗ ВОДЫ — на главную"
        >
          <CatMark className="h-6 w-auto md:h-7" />
          <StencilLogo className="logo-sm" />
        </a>
        {/* Пункты меню не переносятся никогда: перенос ломает высоту шапки
            и рвёт названия («Задачи и / решения»). Полное меню — от 1280 px,
            ниже его заменяет бургер: четыре русских пункта, вход в кабинет
            и действие в одну строку уже, чем в 1280 px, не помещаются. */}
        <nav
          aria-label="Основная навигация"
          className="hidden items-center gap-0.5 t-nav tracking-[0.005em] xl:flex"
        >
          {NAV_LINKS.map(([label, href]) => {
            const active = path === href;
            return (
              <a
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`group relative whitespace-nowrap rounded-sm px-3 py-2 transition-colors duration-[160ms] ${
                  active
                    ? "text-[color:var(--color-text-primary)]"
                    : "text-[color:var(--color-text-secondary)] hover:text-[color:var(--color-text-primary)]"
                }`}
              >
                <span className="relative z-10">{label}</span>
                <span
                  aria-hidden
                  className={`absolute inset-x-3 -bottom-px h-px bg-[color:var(--color-accent)] transition-opacity duration-[160ms] ${
                    active ? "opacity-100" : "opacity-0 group-hover:opacity-60"
                  }`}
                />
              </a>
            );
          })}
        </nav>
        <div className="flex shrink-0 items-center gap-2 md:gap-3">
          {/* Шапка первого касания несёт только навигацию и действие
              (решение Виктории 03.08): «Личный кабинет» уехал в футер и
              мобильное меню, переключатель анимаций убран совсем —
              автоматика prefers-reduced-motion осталась. */}
          <a
            href={ctaHref(path)}
            className={`btn group hidden shrink-0 sm:inline-flex ${pastHero ? "btn-primary" : "btn-secondary"}`}
          >
            <span>{CTA_LABEL}</span>
            <ArrowUpRight
              data-arrow
              className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            />
          </a>
          <button
            ref={burgerRef}
            type="button"
            aria-label={open ? "Закрыть меню" : "Открыть меню"}
            aria-expanded={open}
            aria-haspopup="menu"
            aria-controls="site-menu"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-sm border border-[color:var(--color-line)] bg-[color:var(--color-bg-primary)] text-[color:var(--color-text-primary)] transition-colors hover:bg-[color:var(--color-bg-secondary)]"
          >
            <span className="relative block h-3 w-4">
              <span
                className={`absolute left-0 block h-px w-4 bg-current transition-transform duration-300 ${open ? "top-1.5 rotate-45" : "top-0.5"}`}
              />
              <span
                className={`absolute left-0 block h-px w-4 bg-current transition-transform duration-300 ${open ? "top-1.5 -rotate-45" : "top-2.5"}`}
              />
            </span>
          </button>
        </div>
      </div>

      {/* Тонкая линия прогресса чтения — единственный акцент в шапке. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-[-1px] z-[3] h-px origin-left bg-[color:var(--color-accent)]"
        style={{ transform: `scaleX(${progress})`, opacity: progress > 0.005 ? 1 : 0 }}
      />

      {open && (
        <div
          id="site-menu"
          ref={menuRef}
          role="dialog"
          aria-modal="true"
          aria-label="Меню сайта"
          className="fixed inset-x-0 bottom-0 z-[2] flex flex-col border-t border-[color:var(--color-line)] bg-[color:var(--color-bg-primary)]"
          style={{ top: navH }}
        >
          <nav
            aria-label="Меню сайта"
            className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto overscroll-contain px-5 pb-4 pt-2 md:px-8"
          >
            {/* От 1280 px первые четыре пункта уже стоят строкой в шапке —
                в меню остаётся только второй уровень. */}
            {NAV_LINKS.slice(0, 3).map(([label, href]) => (
              <a
                key={href}
                href={href}
                aria-current={path === href ? "page" : undefined}
                onClick={() => setOpen(false)}
                className="flex min-h-[60px] items-center justify-between border-b border-[color:var(--color-line)] py-4 t-body text-[color:var(--color-text-primary)] xl:hidden"
              >
                {label}
                <ArrowUpRight
                  aria-hidden
                  data-arrow
                  className="h-5 w-5 shrink-0 text-[color:var(--color-text-secondary)]"
                />
              </a>
            ))}
            {/* О нас — отдельный блок, чтобы не сливался с коммерческими страницами. */}
            <div className="mt-6 xl:hidden">
              <div className="pb-2 t-eyebrow text-[color:var(--color-text-secondary)]">О нас</div>
              {NAV_LINKS.slice(3).map(([label, href]) => (
                <a
                  key={href}
                  href={href}
                  aria-current={path === href ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className="flex min-h-[52px] items-center justify-between border-b border-[color:var(--color-line)] py-3 t-body text-[color:var(--color-text-primary)]"
                >
                  {label}
                  <ArrowUpRight
                    aria-hidden
                    data-arrow
                    className="h-5 w-5 shrink-0 text-[color:var(--color-text-secondary)]"
                  />
                </a>
              ))}
            </div>
            {NAV_SECONDARY.map(([label, href]) => (
              <a
                key={href}
                href={href}
                aria-current={path === href ? "page" : undefined}
                onClick={() => setOpen(false)}
                className="flex min-h-[60px] items-center justify-between border-b border-[color:var(--color-line)] py-4 t-body text-[color:var(--color-text-primary)]"
              >
                {label}
                <ArrowUpRight
                  aria-hidden
                  data-arrow
                  className="h-5 w-5 shrink-0 text-[color:var(--color-text-secondary)]"
                />
              </a>
            ))}

            {/* Вход для действующих клиентов */}
            <a
              href={LK_URL}
              target="_blank"
              rel="noopener"
              onClick={() => setOpen(false)}
              className="flex min-h-[60px] items-center justify-between border-b border-[color:var(--color-line)] py-4 t-body text-[color:var(--color-text-primary)]"
            >
              {LK_LABEL}
              <ArrowUpRight
                data-arrow
                className="h-5 w-5 shrink-0 text-[color:var(--color-text-secondary)]"
              />
            </a>
          </nav>
          <div className="shrink-0 border-t border-[color:var(--color-line)] bg-[color:var(--color-bg-primary)] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 md:px-8 [&>*]:mx-auto [&>*]:max-w-3xl">
            <a
              href={ctaHref(path)}
              onClick={() => setOpen(false)}
              className="btn btn-primary flex w-full"
            >
              {CTA_LABEL}
              <ArrowRight data-arrow className="h-4 w-4" />
            </a>
          </div>
        </div>
      )}
    </header>
  );
}

/* -------------------------------- Footer --------------------------------- */

export function Footer() {
  return (
    <footer className="border-t border-[color:var(--color-line)] bg-[color:var(--color-bg-secondary)]">
      <div className="mx-auto max-w-7xl px-5 py-8 md:px-8">
        {/* Навигация переехала в меню шапки: в футере — только контакты
            и юридический блок. */}
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <a
            href="/"
            className="flex items-center gap-3 text-[color:var(--color-text-primary)]"
            aria-label="БЕЗ ВОДЫ — на главную"
          >
            <CatMark
              className="h-8 w-auto text-[color:var(--color-text-primary)]/70"
              strokeWidth={2}
            />
            <StencilLogo className="logo-sm" />
          </a>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 t-body">
            <li>
              <a
                href="tel:+79645842225"
                className="text-[color:var(--color-text-secondary)] transition hover:text-[color:var(--color-accent)]"
              >
                +7 964 584 22 25
              </a>
            </li>
            <li>
              <a
                href="https://t.me/vikky_duck"
                target="_blank"
                rel="noreferrer"
                className="text-[color:var(--color-text-secondary)] transition hover:text-[color:var(--color-accent)]"
              >
                Telegram: @vikky_duck
              </a>
            </li>
            <li>
              <a
                href="mailto:vu@withoutwater.ru"
                className="text-[color:var(--color-text-secondary)] transition hover:text-[color:var(--color-accent)]"
              >
                vu@withoutwater.ru
              </a>
            </li>
            {/* «Личный кабинет» живёт только в меню шапки */}
          </ul>
        </div>
        <div className="mt-6 flex flex-col gap-3 border-t border-[color:var(--color-line)] pt-5 t-caption text-[color:var(--color-text-secondary)]">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <a href="/politics_pd" className="transition hover:text-[color:var(--color-accent)]">
              Политика конфиденциальности
            </a>
            <a href="/consent_pd" className="transition hover:text-[color:var(--color-accent)]">
              Согласие на обработку персональных данных
            </a>
            <a href="/pub_oferta" className="transition hover:text-[color:var(--color-accent)]">
              Публичная оферта
            </a>
          </div>
          <div>
            © {new Date().getFullYear()} БЕЗ ВОДЫ · withoutwater · ИП Уткина Виктория Викторовна ·
            ИНН 771586055972
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------ PageShell -------------------------------- */
/* Общая обёртка каждой страницы: шапка, футер, калм-переключатель, cookie-бар,
   липкая мобильная CTA. */

export function PageShell({ path, children }: { path: string; children: ReactNode }) {
  const [calm] = useCalm();
  /* Липкая мобильная полоса появляется только после первого экрана —
     на hero действие и так одно и видно. */
  const [showBar, setShowBar] = useState(false);
  useEffect(() => {
    const onScroll = () => setShowBar(window.scrollY > window.innerHeight * 0.6);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Метки секций нумеруются подряд по факту отрисовки страницы:
     блоки переиспользуются на разных страницах, поэтому статичные
     номера давали пропуски (03, 06). */
  useEffect(() => {
    const renumber = () => {
      document.querySelectorAll("main [data-seclabel] .stencil").forEach((el, i) => {
        el.textContent = String(i + 1).padStart(2, "0");
      });
    };
    renumber();
    const id = window.setTimeout(renumber, 300);
    return () => window.clearTimeout(id);
  }, [path]);

  return (
    <MotionConfig reducedMotion={calm ? "always" : "user"}>
      {/* Линза кладётся один раз на страницу и обслуживает всё стекло */}
      <LensFilter />
      <GlassPointer />
      <div className="min-h-screen bg-[color:var(--color-bg-primary)] text-[color:var(--color-text-primary)]">
        <Nav path={path} />
        <main className="pb-20 md:pb-0">{children}</main>

        {/* Финал печатной версии: шапка и футер сайта в PDF скрыты, вместо них —
            подпись бюро (брендбук: кот появляется на финальных страницах PDF) */}
        <div className="hidden items-center justify-between gap-6 border-t border-[color:var(--color-line)] px-8 py-6 print:flex">
          <StencilLogo className="logo-md" />
          <CatMark
            className="h-14 w-16 text-[color:var(--color-text-primary)]/70"
            strokeWidth={2}
          />
          <span className="t-caption text-[color:var(--color-text-secondary)]">
            withoutwater.ru
          </span>
        </div>

        <Footer />

        <CookieBar />

        {/* Mobile sticky CTA — плоская FAB, без подписи, в левом нижнем углу.
            Поднята выше cookie-плашки. */}
        <div
          className={`fixed bottom-12 left-4 z-40 md:hidden ${path === "/cases" ? "hidden" : ""} ${
            showBar ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-20 opacity-0"
          }`}
          aria-hidden={!showBar}
        >
          {/* Пилюля с подписью: безымянный кружок с календарём не читался
              как «оставить заявку» (решение 03.08) */}
          <a
            href={ctaHref(path)}
            className="relative inline-flex h-13 items-center gap-2.5 rounded-pill border border-[color:var(--color-text-primary)] bg-[color:var(--color-text-primary)] px-5 py-3.5 t-body font-semibold text-[color:var(--color-surface)] transition-colors duration-150 hover:bg-[color:var(--color-ink-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2"
            aria-label={CTA_LABEL}
            tabIndex={showBar ? 0 : -1}
          >
            <Calendar className="h-4.5 w-4.5" strokeWidth={1.5} />
            Разбор за 30 минут
          </a>
        </div>
      </div>
    </MotionConfig>
  );
}

/* Обложка внутренней страницы: угольная сцена, хром, стекло — тот же
   материал, что и на главной (брендбук, разд. 7). */
/* Хромовое кольцо как индикатор прогресса чтения страницы.
   Дуга заполняется по мере скролла, в центре — процент.
   Клик: вверху — уводит к следующему экрану, дальше — возвращает наверх. */
export function ScrollRing({ className = "" }: { className?: string }) {
  const [p, setP] = useState(0);

  useEffect(() => {
    let raf = 0;
    const read = () => {
      raf = 0;
      const el = document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      setP(max > 8 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const pct = Math.round(p * 100);
  const R = 46;
  const C = 2 * Math.PI * R;
  const atTop = p < 0.02;

  const onClick = () => {
    if (atTop) {
      window.scrollTo({ top: window.innerHeight * 0.92, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={atTop ? "Листать дальше" : `Прочитано ${pct}% — наверх`}
      title={atTop ? "Листать дальше" : "Наверх"}
      className={`card-link group pointer-events-auto absolute hidden aspect-square rounded-pill md:block print:hidden ${className}`}
    >
      <span
        className="absolute -inset-[12%] rounded-pill opacity-60"
        aria-hidden
        style={{
          background: "radial-gradient(closest-side, rgba(228,169,206,0.12), rgba(228,169,206,0))",
          filter: "blur(8px)",
        }}
      />
      <span className="chrome-ring absolute inset-0" aria-hidden />

      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full -rotate-90"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke="rgba(232,238,247,0.12)"
          strokeWidth="1.5"
        />
        <circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - p)}
          style={{ transition: "stroke-dashoffset 120ms linear" }}
        />
      </svg>

      <span className="absolute inset-0 grid place-items-center">
        <span className="t-caption tabular-nums text-[color:var(--color-text-inverse)]/70">
          {pct}%
        </span>
      </span>
    </button>
  );
}

export function PageHead({
  kicker,
  title,
  lead,
  guide,
  chips,
  actions,
}: {
  kicker: string;
  title?: ReactNode;
  lead?: ReactNode;
  /* Одна строка-ориентир под лидом: что здесь и куда идти дальше */
  guide?: ReactNode;
  chips?: [string, string][];
  actions?: ReactNode;
}) {
  return (
    <div className="stage sec-dark grain relative -mx-0 border-b border-[color:var(--color-line-dark)]">
      <div className="stage__bg" aria-hidden>
        {/* Волосяные колонки 12-й сетки */}
        <div
          className="absolute inset-y-0 left-0 right-0 hidden md:block"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to right, rgba(232,238,247,0.055) 0 1px, transparent 1px 8.3333%)",
            WebkitMaskImage:
              "linear-gradient(to bottom, transparent, #000 20%, #000 80%, transparent)",
            maskImage: "linear-gradient(to bottom, transparent, #000 20%, #000 80%, transparent)",
          }}
        />
        {/* Графитовая пыль */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 82% 14%, rgba(201,205,212,0.10), transparent 58%)," +
              "radial-gradient(80% 70% at 8% 100%, rgba(126,92,158,0.18), transparent 62%)",
          }}
        />
        <NodeScene className="text-[color:var(--color-text-inverse-2)]" opacity={0.3} />
        <NodeScene
          className="!right-auto !left-[1%] !top-auto !bottom-[-10%] !h-[min(64%,340px)] text-[color:var(--color-text-inverse-2)]"
          opacity={0.34}
        />
      </div>

      {/* Кольцо-индикатор прогресса убрано (решение Виктории 03.08): оно
          сообщало процент прочитанного — сведение, которое читателю не нужно,
          — и из-за конфликта .card-link (position:relative) с классом absolute
          висело обрезанным за левым краем на всех страницах. Компонент
          ScrollRing оставлен ниже: вернуть — одна строка. */}

      <div className="relative z-10 mx-auto max-w-7xl px-5 pb-14 pt-12 md:px-8 md:pb-20 md:pt-24">
        <div className="t-eyebrow flex items-center gap-3 text-[color:var(--color-text-inverse-2)]">
          <span className="tex-chrome h-[2px] w-12 rounded-pill" />
          <span>{kicker}</span>
        </div>
        {title && (
          <RevealHeading
            as="h1"
            className="t-h1 mt-5 max-w-4xl text-[color:var(--color-text-inverse)]"
          >
            {title}
          </RevealHeading>
        )}
        {lead && (
          <p
            className={`t-body measure text-[color:var(--color-text-inverse-2)] ${title ? "mt-6" : "mt-5"}`}
          >
            {lead}
          </p>
        )}
        {/* Строка-ориентир: как читать страницу и куда идти дальше (приёмка, п. 6). */}
        {guide && (
          <p className="t-eyebrow mt-5 text-[color:var(--color-text-inverse-2)]">{guide}</p>
        )}
        {actions && (
          <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-5 print:hidden">
            {actions}
          </div>
        )}
        {chips && chips.length > 0 && (
          <div className="mt-9 grid max-w-3xl gap-4 sm:grid-cols-2 md:mt-12">
            {chips.map(([label, desc]) => (
              <div key={label} className="surface-dark rounded-md px-5 py-6 md:px-6">
                <div className="font-display t-body text-[color:var(--color-text-inverse)]">
                  {label}
                </div>
                <p className="t-body mt-3 text-[color:var(--color-text-inverse-2)]">{desc}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- CtaBand --------------------------------- */
/* Одинаковый финал каждой внутренней страницы: одно действие, одна подпись.
   Страницы раздела «Бизнес-эффект» подставляют свои заголовок и подпись из
   документа текстов (экраны «Следующий шаг»), остальное не меняется. */

export function CtaBand({
  path = "/",
  title,
  note,
  secondary,
}: {
  path?: string;
  title?: ReactNode;
  note?: ReactNode;
  /* null — убрать вторую ссылку (на страницах самого «Бизнес-эффекта») */
  secondary?: ReactNode | null;
}) {
  const defaultSecondary = (
    <a
      href="/business-effect"
      className="link-arrow group t-body text-[color:var(--color-text-inverse-2)] hover:text-[color:var(--color-text-inverse)]"
    >
      Бизнес-эффект от сотрудничества
      <ArrowUpRight
        data-arrow
        className="h-4 w-4 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
      />
    </a>
  );
  return (
    <section className="stage sec-dark grain border-t border-[color:var(--color-line-dark)]">
      <Scene blobs={[{ className: "-left-40 top-0", tone: "rose", size: 460 }]} />
      <div className="relative mx-auto max-w-7xl px-5 sec-pad md:px-8">
        <div className="t-eyebrow flex items-center gap-3 text-[color:var(--color-text-inverse-2)]">
          <span className="tex-chrome h-[2px] w-12 rounded-pill" />
          <span>Следующий шаг</span>
        </div>
        <RevealHeading className="t-h2 mt-6 max-w-3xl text-[color:var(--color-text-inverse)]">
          {title ?? "Что будет на разборе"}
        </RevealHeading>
        <p className="t-body measure mt-5 text-[color:var(--color-text-inverse-2)]">
          {note ?? (
            <>
              30 минут онлайн: сверим задачу, доступные источники опыта и возможный результат
              первого этапа
            </>
          )}
        </p>
        <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6 print:hidden">
          <a href={ctaHref(path)} className="btn btn-invert group w-full sm:w-auto">
            <span>{CTA_LABEL}</span>
            <ArrowRight
              data-arrow
              className="h-4 w-4 transition-transform duration-500 group-hover:translate-x-1"
            />
          </a>
          <span className="t-body text-[color:var(--color-text-inverse-2)]">
            Ответим в течение двух рабочих часов
          </span>
          {secondary === null ? null : (secondary ?? defaultSecondary)}
        </div>
        {/* Прямые каналы в каждом финале (решение Виктории 03.08: «нужно,
            чтобы везде была возможность написать или позвонить») */}
        <p className="mt-5 t-body text-[color:var(--color-text-inverse-2)]">
          Или напрямую:{" "}
          <a
            href="https://t.me/vikky_duck"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-[color:var(--color-text-inverse)] underline underline-offset-4 transition hover:text-[color:var(--color-accent-glass)]"
          >
            Telegram @vikky_duck
          </a>
          {" · "}
          <a
            href="tel:+79645842225"
            className="font-semibold text-[color:var(--color-text-inverse)] underline underline-offset-4 transition hover:text-[color:var(--color-accent-glass)]"
          >
            +7 964 584 22 25
          </a>
        </p>
      </div>
    </section>
  );
}
