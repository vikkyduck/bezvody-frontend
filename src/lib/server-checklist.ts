/**
 * Шпаргалка 6-pager для экрана. Только сервер.
 *
 * Методика уезжает в браузер ответом сервера и только вошедшему человеку —
 * в собранном приложении её нет. То же правило, что и у инструкций ролей:
 * за этот текст заказчик заплатил, в открытом бандле ему не место.
 */
import { createServerFn } from "@tanstack/react-start";

import type { ChecklistSection } from "./sixpager";

export const getChecklistServer = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }): Promise<{ sections: ChecklistSection[] }> => {
    const d = await import("./server-data");
    const { me } = await d.whoIs(String(data.code ?? ""));
    if (!me) return { sections: [] };

    const { SIXPAGER } = await import("./sixpager");
    return { sections: SIXPAGER };
  });
