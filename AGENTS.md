<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## NOWATER.TECH typography rule

- Use **Manrope** for all customer-facing typography: display headlines, body copy, labels, buttons, and the NOWATER.TECH wordmark.
- Match the approved keynote reference: display headlines use weight 400, tight line-height (about 0.96–1.10), and normal letter spacing; controls and microcopy use weights 600–700.
- Do not substitute Golos Text or Unbounded on new NOWATER.TECH screens. Unbounded may remain only on untouched legacy screens.

## Логотип и значки NOWATER.TECH

- Для крупного брендинга и превью ссылок используется предоставленная пользователем полная надпись "БЕЗ ВОДЫ" на черном фоне. Исходный файл и его SHA-256 указаны в `public/brand/README.md`. Полный исходник сохраняется без изменений, допустимы техническое изменение размера, удаление внешних пустых полей и подписи withoutwater.
- Для favicon, закладок и иконок телефона пользователь отдельно утвердила компактный вариант "БВ": белые буквы на черном фоне с черной горизонтальной полосой зачеркивания. Использовать зафиксированный PNG-мастер из `branding.json`, поля `iconSource` и `iconSourceSha256`. Этот вариант создан по новой просьбе пользователя и является разрешенным исключением из прежнего запрета на новые символы. Не объявлять его пиксельно идентичным буквам полного исходника.
- Запрещены неутвержденные замены обоих вариантов: Lovable, кот, эмодзи, другая монограмма или повторная генерация знака без новой просьбы пользователя. Технические размеры производятся из закрепленных мастеров, при обычной сборке форма знаков не меняется.
- `branding.json` - единственный источник путей к favicon, ICO, PNG, Apple touch icon, web manifest и изображению превью. Основные страницы используют `src/lib/brand-head.ts`, включая аварийный HTML.
- Веб-генератор отчета `reports/avito-goods-2026-11-03/build-web.py` принимает явный Markdown и не выполняет почтовую рассылку. Все самостоятельные HTML, включая AI-радары, проходят через `scripts/brand-publications.mjs`. Новые публичные отчеты регистрируются в `deploy/ai-radar-publications.json` и публикуются через `deploy/publish-reports.sh`. Один общий head приложения не покрывает отдельные HTML.
- Еженедельный AI-радар Авито Товаров публикуется не через `deploy/publish-reports.sh`, а шлюзом `nowater-radar`: `deploy/radar_gateway.py`, установка `deploy/setup-radar.sh`, порядок работы в `radar/README.md`. Страницы собирает `radar/render.py` с тем же `scripts/brand-publications.mjs`. Ева публикует их сама, в репозиторий они не попадают. Адрес по шаблону `/AI-radar/Avito/Goods/<период>` прописан в `deploy/nginx-nowater-ai-radar.conf`, этот файл ставят и `publish-reports.sh`, и `setup-radar.sh`, поэтому шаблон правится только там.
- Перед сборкой и публикацией обязательна `npm run check:branding`. Она должна отклонять отсутствующие или чужие значки. Нельзя ограничивать исправление одной страницей или только общим SSR head.
- При изменении логотипа или малых значков создается новая версия путей ассетов. Старые наборы не удаляются. Корневые fallback `favicon.ico`, `favicon.svg`, `apple-touch-icon.png` и `site.webmanifest` должны совпадать с текущим набором значков. Полный исходник и изображение превью могут оставаться из предыдущей утвержденной версии.
- Письмо еженедельного AI-радара собирает `radar/render.py`, функция `mail`. Выпуск построен по пирамиде Минто в три уровня чтения. Письмо - первые два, его читатель - продажи: суть недели, карта сути, сигналы с заголовками-выводами, цифра недели и возможный вопрос клиенту. Оно берет из каждого поля первый абзац без ссылок на источники и своих слов в текст не добавляет (тест `test_letter_takes_its_words_from_the_issue`). Третий уровень - источники, полный текст, идеи фич, сводная таблица, шум - несет страница, слово в слово (тест `test_page_carries_the_issue_word_for_word`). Оформление письма утверждено 24.11.2026 и закреплено тестом `test_letter_is_clean_for_the_eye`: три цвета текста без серого, пять размеров шрифта, подпись блока на своей строке и текст с новой, без двоеточий после подписей, без кавычек вокруг вопроса, без точки у сути и заголовков, одна ссылка - кнопка на страницу. Раздел сути называется "Суть", слова "вывод", "аргументы", "история" в подписях не пишутся. Свои слова сборщика - без команд читателю: тон письма вежливый и деликатный (тест `test_own_words_of_the_letter_are_polite`). Цвета письма заданы константами рядом с функцией и должны совпадать с `src/styles.css`. Верстка только на таблицах со стилями на самих элементах, без картинок, скриптов и внешних шрифтов. На странице якоря `main`, `signals`, `signal-N`, `product`, `noise` сохранять.
