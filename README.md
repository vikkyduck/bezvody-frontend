# Фронтенд платформы «Без Воды»

Рабочее место команды: кабинет, каталог агентов, решения, пределы риска, админка.
Дизайн рисуется в [Lovable](https://lovable.dev), экспорт лежит здесь как есть.

Бэкенд платформы — отдельный репозиторий `~/bezvody-platform` (контракт в его
`API.md`). Пока фронт живёт на встроенных демо-данных (`src/lib/shtab-data.ts`),
запросов к бэкенду не делает — это следующий шаг.

## Прод

Timeweb VDS (РФ, контур 152-ФЗ): **http://5.129.198.180:8093/**

```sh
./deploy.sh          # типы → сборка nitro (node-server) → .output/ на сервер → рестарт
```

Устройство сервера и первичная установка — [deploy/SETUP.md](deploy/SETUP.md).
Экспорт Lovable — не статика, а TanStack Start (серверный рендер), поэтому на
сервере крутится node-процесс, а не просто папка в nginx.

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
