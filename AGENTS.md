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

- Утвержденный логотип сайта - предоставленная пользователем надпись "БЕЗ ВОДЫ" на черном фоне. Исходный файл и его SHA-256 указаны в `public/brand/README.md`. Не перерисовывать буквы и не заменять логотип знаком Lovable, котом, эмодзи или новым символом.
- Допустимы техническое изменение размера, удаление внешних пустых полей и подписи withoutwater. Исходный файл сохраняется без изменений.
- `branding.json` - единственный источник путей к favicon, ICO, PNG, Apple touch icon, web manifest и изображению превью. Основные страницы используют `src/lib/brand-head.ts`, включая аварийный HTML.
- Веб-генератор отчета `reports/avito-goods-2026-11-03/build-web.py` принимает явный Markdown и не выполняет почтовую рассылку. Все самостоятельные HTML, включая AI-радары, проходят через `scripts/brand-publications.mjs`. Новые публичные отчеты регистрируются в `deploy/ai-radar-publications.json` и публикуются через `deploy/publish-reports.sh`. Один общий head приложения не покрывает отдельные HTML.
- Перед сборкой и публикацией обязательна `npm run check:branding`. Она должна отклонять отсутствующие или чужие значки. Нельзя ограничивать исправление одной страницей или только общим SSR head.
- При изменении логотипа создается новая версия путей ассетов. Корневые fallback `favicon.ico` и `favicon.svg` также должны содержать утвержденный логотип.
