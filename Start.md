Открой Терминал на Mac и выполняй команды по очереди.

1. Перейди в папку проекта:
cd /Users/mac/Documents/Codex/2026-11-14/x20/outputs/download-speed-test
2. Установи зависимости:
npm ci
3. Собери TypeScript в JavaScript:
npm run build
4. Запусти замер, например со ссылкой на картинку:
npm start -- "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png"