# Calm Calendar

Календарь для Windows без рекламы. Работает с Google Календарём: виды на день, неделю и месяц, создание, правка и удаление событий, включение и выключение отдельных календарей.

Стек: Tauri 2 (Rust), React 19, TypeScript, Effector, CSS Modules. Даты — нативные `Date` и `Intl`, без библиотек.

## Как устроен вход

- Вход через системный браузер. Приложение принимает код на `127.0.0.1` и использует PKCE (защиту обмена кодом).
- Токен обновления хранится в диспетчере учётных данных Windows (на macOS — в связке ключей), не в файле.
- Токены не попадают в интерфейс: запросы к Google Calendar API делает Rust-часть, фронтенд передаёт только путь и параметры. Разрешены только пути `/calendar/v3/…`.
- Права: `calendar.calendarlist.readonly` (список календарей) и `calendar.events` (события), плюс `openid email` для показа адреса.

## Настройка Google Cloud (один раз)

1. Открой [console.cloud.google.com](https://console.cloud.google.com) и создай проект.
2. «APIs & Services» → «Library» → найди **Google Calendar API** → «Enable».
3. «Google Auth Platform» → «Branding»: название приложения и email поддержки.
4. «Audience»: тип **External**. Затем нажми **Publish app**, чтобы статус стал «In production». Проверку проходить не нужно. Без публикации (статус «Testing») вход слетает каждые 7 дней.
5. «Data access» → «Add or remove scopes»: добавь `.../auth/calendar.calendarlist.readonly` и `.../auth/calendar.events`.
6. «Clients» → «Create client» → тип **Desktop app** → создай и скачай JSON.
7. Запусти приложение и вставь содержимое JSON целиком в форму «Подключение к Google».

При первом входе Google покажет «Приложение не проверено»: нажми «Дополнительно» → «Перейти в Calm Calendar». Без проверки приложением могут пользоваться до 100 аккаунтов за всё время.

Файл клиента лежит в `%APPDATA%\com.arseni.calmcalendar\google-client.json`. Для сборки в Store клиент можно зашить при компиляции: переменные окружения `CALM_GOOGLE_CLIENT_ID` и `CALM_GOOGLE_CLIENT_SECRET`.

## Сборка на Windows

Нужно один раз:

1. [Node.js](https://nodejs.org) LTS.
2. [Rust](https://rustup.rs) через `rustup-init.exe`.
3. «Microsoft C++ Build Tools» с нагрузкой «Desktop development with C++» (установщик Rust предложит её сам).
4. WebView2 в Windows 11 уже есть.

Потом:

```powershell
npm install
npm run tauri dev      # запуск в режиме разработки
npm run tauri build    # установщики в src-tauri\target\release\bundle\
```

## Разработка интерфейса в браузере

`npm run dev` открывает интерфейс на http://localhost:1420 с подставными календарями и событиями (`src/shared/api/mock.ts`). В сборку приложения подставные данные не попадают.

## Выпуск версии

На каждый пуш в `main` GitHub запускает только тесты (`ci`). Установщики собирает `release`:

1. Поменяй версию в `package.json`, `src-tauri/tauri.conf.json` и `src-tauri/Cargo.toml`.
2. Закоммить и поставь тег: `git tag v0.2.0` и `git push origin main v0.2.0`.
3. Через 10–15 минут в разделе Releases появится релиз с `.exe` и `.msi`.

Собрать без тега: Actions → release → Run workflow. Установщики будут в Artifacts этого запуска.

## Проверки

```powershell
npm test               # тесты дат, раскладки событий, формы
npx tsc --noEmit       # типы
cd src-tauri; cargo test
```

## Горячие клавиши

`←` `→` — листать, `T` — сегодня, `D` `W` `M` — день, неделя, месяц, `N` — новое событие, `Esc` — закрыть форму. Работают и на русской раскладке.

## Структура

```
src/
  app/          корневой компонент, таймеры, горячие клавиши
  model/        Effector: вход, вид, календари, события, форма события
  shared/api/   мост к Rust, Google Calendar API, подставные данные
  shared/lib/   даты, раскладка пересекающихся событий, localStorage
  ui/           компоненты и CSS Modules
src-tauri/src/
  oauth.rs      вход через браузер, PKCE, токены
  google.rs     прокси к Calendar API
  config.rs     клиент OAuth и сохранённый аккаунт
```

## Дальше

- Уведомления о событиях.
- Автозапуск и значок в трее.
- Публикация в Microsoft Store (MSIX) после проверки приложения в Google.
