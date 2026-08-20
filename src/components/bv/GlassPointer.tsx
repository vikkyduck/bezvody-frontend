import { useEffect } from "react";

/**
 * Стекло «ловит свет»: под курсором на пластине появляется мягкий блик,
 * координаты которого передаются в CSS через --mx / --my, а сила — через --sheen.
 * Один слушатель на документ вместо обработчиков на каждой карточке.
 *
 * Пластины выше экрана пропускаем: блик по ним — это перерисовка всей площади
 * на каждое движение мыши, а видно от неё всё равно один экран.
 */
export function GlassPointer() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(hover: none)").matches) return;

    let current: HTMLElement | null = null;
    let frame = 0;
    let next: { el: HTMLElement; x: number; y: number } | null = null;

    const apply = () => {
      frame = 0;
      if (!next) return;
      const { el, x, y } = next;
      el.style.setProperty("--mx", `${x}px`);
      el.style.setProperty("--my", `${y}px`);
      el.style.setProperty("--sheen", "1");
    };

    const clear = (el: HTMLElement | null) => {
      if (!el) return;
      el.style.setProperty("--sheen", "0");
    };

    const onMove = (e: PointerEvent) => {
      const target = e.target as Element | null;
      const el = target?.closest?.(".card-flat") as HTMLElement | null;
      if (el !== current) {
        clear(current);
        current = el;
      }
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.height > window.innerHeight * 1.5) return;
      next = { el, x: e.clientX - r.left, y: e.clientY - r.top };
      if (!frame) frame = requestAnimationFrame(apply);
    };

    const onLeave = () => {
      clear(current);
      current = null;
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave, { passive: true });
    window.addEventListener("blur", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      if (frame) cancelAnimationFrame(frame);
      clear(current);
    };
  }, []);

  return null;
}
