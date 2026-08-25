/**
 * Доставка готового разбора туда, куда попросил клиент.
 *
 * Разбор пишется минутами, а у человека восемь минут между встречами: он
 * задал вопрос, ушёл — и до сих пор узнать о готовности можно было только
 * вернувшись в кабинет. Теперь готовый документ сам приходит в телеграм
 * и/или письмом — по тумблерам, которые человек включил у себя в кабинете.
 * По умолчанию оба выключены: рассылка, о которой не просили, хуже тишины.
 *
 * Всё здесь fire-and-forget: доставка — курьер, а не часть работы. Упавший
 * телеграм или почта не должны стоить человеку ответа, поэтому ошибки
 * ловятся, пишутся в журнал и наружу не выходят никогда.
 */
const log = (msg: string) => console.log(`[доставка] ${msg}`);

/**
 * Разослать готовый разбор по включённым каналам.
 *
 * Word-файл собираем один раз и отдаём в оба канала одинаковым: человек,
 * получивший документ в телеграме и в почте, должен видеть один и тот же файл.
 * Короткие служебные реплики («вопрос сохранён, попробуйте ещё раз») сюда
 * не попадают — за этим следит вызывающий: доставляется документ, а не шум.
 */
export async function deliverAnswer(opts: {
  personId: string;
  windowId: string;
  messageId: string;
  /** Название задачи — тема письма и подпись в телеграме */
  taskTitle: string;
  /** Кто отвечал: агент или роль — человеку важно, чей это вердикт */
  speaker: string;
}): Promise<void> {
  // Карточку читаем сами: внутренний путь ответа знает о человеке только id,
  // и тащить туда полный справочник ради доставки было бы лишней связью.
  const d = await import("./server-data");
  const person = (await d.readParticipants()).find((p) => p.id === opts.personId);
  if (!person) return;
  const wantTg = Boolean(person.deliver?.telegram);
  const wantMail = Boolean(person.deliver?.email) && Boolean(person.email.trim());
  if (!wantTg && !wantMail) return;

  try {
    // Файл — тем же путём, что и кнопка «Скачать в Word»: один код сборки,
    // один и тот же документ на экране, в телеграме и в письме.
    const { buildAnswerDocx } = await import("./server-files");
    const file = await buildAnswerDocx(person.id, opts.windowId, opts.messageId);
    if (!file.ok) {
      log(`файл для «${person.name}» не собрался — доставка пропущена`);
      return;
    }

    const caption = `${opts.taskTitle} — ${opts.speaker}. Готовый разбор во вложении.`;

    if (wantTg) {
      const { tgSendDocument } = await import("./server-telegram");
      void tgSendDocument(person.id, {
        name: file.name,
        base64: file.base64,
        caption,
      }).catch((e) => log(`телеграм для «${person.name}»: ${String(e)}`));
    }

    if (wantMail) {
      const { sendMailServerSide } = await import("./server-mail");
      void sendMailServerSide({
        to: person.email,
        subject: `Готов разбор: ${opts.taskTitle}`,
        text:
          `Здравствуйте!\n\n${opts.speaker} закончил работу по задаче «${opts.taskTitle}». ` +
          `Готовый документ во вложении.\n\n` +
          `Полная переписка и остальные материалы — в вашем кабинете: https://nowater.tech\n`,
        attachment: {
          name: file.name,
          base64: file.base64,
          mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      }).then(
        (r) => {
          if (!r.ok) log(`почта для «${person.name}»: ${r.note}`);
        },
        (e) => log(`почта для «${person.name}»: ${String(e)}`),
      );
    }
  } catch (e) {
    // Доставка не имеет права уронить ответ — что бы ни случилось.
    log(`сбой доставки для «${person.name}»: ${String(e)}`);
  }
}
