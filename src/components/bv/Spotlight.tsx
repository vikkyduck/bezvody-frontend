import { motion, useMotionValue, useSpring, useTransform } from "motion/react";

/** Мягкий блик, следующий за курсором: появляется только при hover родителя (.group). */
export function Spotlight() {
  const x = useMotionValue(50);
  const y = useMotionValue(50);
  const sx = useSpring(x, { stiffness: 140, damping: 22 });
  const sy = useSpring(y, { stiffness: 140, damping: 22 });
  const bg = useTransform(
    [sx, sy],
    ([px, py]: number[]) =>
      `radial-gradient(220px circle at ${px}% ${py}%, color-mix(in oklab, var(--color-accent) 14%, transparent), transparent 70%)`,
  );

  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
      style={{ backgroundImage: bg }}
      ref={(el) => {
        const parent = el?.parentElement;
        if (!parent || parent.dataset["spot"] === "1") return;
        parent.dataset["spot"] = "1";
        parent.addEventListener("pointermove", (e) => {
          const r = parent.getBoundingClientRect();
          x.set(((e.clientX - r.left) / r.width) * 100);
          y.set(((e.clientY - r.top) / r.height) * 100);
        });
      }}
    />
  );
}
