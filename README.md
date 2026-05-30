# tg-bridge

Свой Telegram-мост для **интерактивных** сессий Claude Code. Заменяет шаблон `claude -p` (Agent SDK) перед тем, как Anthropic с **2026-06-15** разделит биллинг и SDK-вызовы пойдут из отдельного пула $200/месяц.

Один процесс моста на один агент. Каждый мост держит свою долгоживущую `tmux`-сессию, в которой запущен `claude --dangerously-skip-permissions`. Сообщения из Telegram отправляются в `tmux` как нажатия клавиш; хуки Claude Code дёргают мост обратно, чтобы доставить ответы, запросы разрешений и live-прогресс по вызовам инструментов.

```
оператор ──Telegram──> grammY poller ──tmux send-keys──> claude (interactive)
                                                            │
                                                            ├─ PostToolUse ─┐
                                                            ├─ PreToolUse ──┤  HTTP /hooks/*
                                                            └─ Stop ────────┘  (Bearer auth)
                                                                  │
оператор <──Telegram── editMessageText / sendMessage <───── HTTP-сервер моста
```

## Зачем это нужно

Старый [jarvis-telegram-gateway](https://github.com/qwwiwi/jarvis-telegram-gateway) для каждого сообщения поднимал свежий `claude -p ... stream-json`. После **2026-06-15** каждый такой вызов биллится из SDK-пула, а не из подписки Max. Этот мост держит **одну** интерактивную сессию Claude Code на агент — расходы остаются в Max.

## Возможности

### Входящие (оператор → агент)

- **Текст** — прозрачная пересылка (опционально с префиксом-персоной `[Operator/<id>]`).
- **Голос / аудио** — скачивается, транскрибируется в [Groq Whisper](https://groq.com) (`whisper-large-v3`), транскрипт инжектится как текст. Telegram-файлы `.oga` переименовываются в `.ogg` — иначе Groq отклоняет. Требует `GROQ_API_KEY_FILE`.
- **Документ / фото / видео** — сохраняется в `<workspace>/.tg-uploads/<UTC-ts>-<safe-name>`, в сессию инжектится строка `Operator fayl yubordi: <path>` (с captionом, если был). Дальше агент сам читает файл штатным `Read`.
- **Allow-list** — отбрасывает всё, что не из `TELEGRAM_ALLOWED_USER_IDS` / `TELEGRAM_ALLOWED_CHAT_IDS`.

### Live-прогресс (агент → оператор)

- **Получено** — реакция 👀 на сообщении оператора сразу, как мост его принял.
- **Edit-in-place** — одно сообщение `<pre>working — Xs … ▸ [B] bash git status</pre>`, обновляемое по мере вызовов (хук `PostToolUse`). После `Stop` удаляется, если итоговый ответ непустой.
- **Тэги инструментов** — `[R]ead [W]rite [B]ash [G]rep [F]etch [S]earch [A]gent [T]odoWrite`. Показываются последние 5; старые сворачиваются в `... +N earlier`. Каждая строка-описание прогоняется через `mask_secrets` (IPv4, токены, supabase URL, пути с `secrets/`).
- **TodoWrite plan** — когда агент дёргает `TodoWrite`, план рендерится Unicode-прогрессбаром (`▰▰▰▱▱▱▱ 50%`) с маркерами x / > / пусто.
- **Subagent tracking** — диспатчи `Task` появляются в секции `agents:`. `PreToolUse` помечает `> running`, `PostToolUse` переключает на `x done`.
- **Режимы стриминга** — `STREAMING_MODE=off|partial|progress` на каждый агент. `off` — без прогресс-сообщения вообще (только финальный ответ); `partial` — сообщение есть, но без tool-трекинга; `progress` (по умолчанию) — полный live.
- **Готово** — реакция 👍 (или то, что агент выдал через `[REACT:slug]`) на исходное сообщение после `Stop`.
- **Typing-индикатор** — `typing...` в Telegram, пока агент думает (обновляется каждые 4 секунды).

### Выходные виджеты

- **Inline-кнопки** — агент завершает ответ маркером `[BUTTONS: Ha=yes | Yo'q=no | Boshqa=other]`. Мост отправляет ответ с inline-клавиатурой; нажатие отправляет payload обратно в агент как новый ход (FIFO-очередь, FSM-gate). Часто встречающиеся метки (`Ha`, `Yes`, `Yo'q`, `No`, `Cancel`, …) автоматически украшаются ✅ / ❌; метки, начинающиеся с эмодзи, остаются как есть. До 8 кнопок; payload ≤59 байт (лимит `callback_data` в Telegram 64 минус префикс `abtn:`).
- **Outbound-файлы** — агент пишет `[FILE: /tmp/report.pdf caption="Отчёт" kind=document]`. Мост отправляет файл по типу (photo/video/voice/document, тип угадывается по расширению или указывается явно).
- **HTML-форматирование** — `**жирный**`, `*курсив*`, `` `код` ``, ```` ```блок``` ```` и `[ссылка](url)` конвертируются в HTML (`parse_mode=HTML`).
- **Markdown-таблицы** — GFM-таблицы (`| col | col |`) разворачиваются в bold-заголовок + bullet-список (Telegram таблицы не рендерит, и так читается).
- **Permission relay** — хук `PreToolUse` может спросить оператора Allow/Deny inline-кнопками для чувствительных инструментов (настраивается через `permission-policy.yaml`).

### Внутреннее

- **gbrain swarm ingress** — `POST /hooks/agent` принимает кросс-агентские push-сообщения от gbrain swarm-worker.
- **FSM-gated очередь** — `IDLE` / `BUSY` / `WAITING_PERMISSION`; сообщения, пришедшие в `BUSY`, ставятся в FIFO.
- **Heartbeat-таймаут** — `BUSY_TIMEOUT_MS` (по умолчанию 300 с) сбрасывается на каждом `PreToolUse`, `PostToolUse` и каждые 30 с при изменении содержимого tmux-пана. Force-IDLE срабатывает только при реальной многоминутной тишине.
- **Paste-safe sendKeys** — текст отправляется в `tmux send-keys -l`, затем 150 мс паузы, затем `Enter` отдельным вызовом. Без паузы paste-detection Claude Code глотает submit на длинных вводах (пути к файлам, многострочный текст).
- **409 polling conflict** — если рядом случайно остался другой polling-инстанс того же бота, grammY делает retry сам, а мост пишет об этом в лог.
- **/status команда** — `/status` в чате с ботом отвечает текущим состоянием (uptime, FSM, длина очереди, активный turn).
- **Auto-cleanup** — `.tg-uploads/` чистится при старте и раз в сутки (TTL по `UPLOADS_TTL_DAYS`, по умолчанию 30).
- **Маскировка секретов** — IPv4, supabase-URL'ы, пути с `secrets/`, длинные токеноподобные строки в прогресс-строках заменяются на `***`.

### Опционально: зеркало в Postgres

Если в окружении задан `DATABASE_URL_FILE`, мост пишет каждый ход в таблицу `chat_log` (in/out) и обновляет `agent_state` (working/idle, current_task). Это нужно, только если у вас есть отдельная веб-панель, читающая эту базу. Без переменной — режим Telegram-only, никакого Postgres не требуется.

## Стек

- Bun 1.3+ (без отдельного build — systemd запускает `bun run src/server.ts` напрямую)
- TypeScript strict mode (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- [grammY](https://grammy.dev) для Telegram
- `tmux` 3.4+ — на каждый агент свой сокет (`-L tgbridge-<agent>`), сессии изолированы
- `zod` для валидации env
- `js-yaml` для permission policy
- `postgres` для опционального DB-зеркала
- `bun:test` для юнит- и интеграционных тестов

## Структура

```
src/
  server.ts                 главный wiring (HTTP, бот, FSM, tmux, tracker)
  config.ts                 zod env-схема (strictBool для случая "false")
  log.ts                    логгер с маскировкой секретов
  claude/
    state.ts                FSM
    queue.ts                bounded FIFO
    tmux-session.ts         контроллер tmux-сокета
  hooks/
    http-server.ts          Bun.serve с Bearer auth, маршруты /hooks/*
    stop.ts                 Stop hook → assistant_message
  progress/
    tracker.ts              edit-in-place ProgressTracker
    mask.ts                 mask_secrets
  permission/
    policy.ts               YAML pattern matcher (какие тулы требуют подтверждения)
    relay.ts                inline-кнопки Allow/Deny round-trip
  reply/
    parser.ts               извлекает [REACT:slug], [BUTTONS:…], [FILE:…]
    sender.ts               чанкинг сообщений Telegram (лимит 4096)
    markdown.ts             GFM-таблицы → bullets, markdown → HTML
  voice/
    groq.ts                 Whisper-транскрипция через Groq
  telegram/
    file.ts                 Telegram getFile + download (.oga → .ogg)
    bot.ts                  grammY-обёртка (sendText, sendHtml, editHtml, setReaction, sendFile, sendChatAction)
    gate.ts                 allow-list
  persona/
    sender-prefix.ts        опциональный префикс на входящих
  uploads/
    cleanup.ts              TTL-чистка .tg-uploads
  db/
    pool.ts                 опциональный Postgres-пул
    chat_log.ts             зеркало in/out
    agent_state.ts          working/idle upsert
scripts/
  install-hooks.sh          патчит <workspace>/.claude/settings.json (Stop+PreToolUse+PostToolUse)
  hook-post.ts              универсальный hook-адаптер (stdin → HTTP моста)
deploy/
  tg-bridge@.service        systemd-шаблон (EnvironmentFile на каждый агент)
  tg-bridge.target          общий target
tests/                      bun:test (114 тестов)
```

## Какие хуки ставятся в settings агента

`install-hooks.sh` патчит `<workspace>/.claude/settings.json` маркированными записями (идемпотентно — повторный запуск перезаписывает):

| Событие | Endpoint | Зачем |
|---|---|---|
| `Stop` | `/hooks/stop` | Доставить финальный ответ ассистента в Telegram, поставить 👍 / `[REACT:*]` |
| `PreToolUse` | `/hooks/pretool` | Pattern policy: пропустить (allow) или спросить оператора Allow/Deny |
| `PostToolUse` | `/hooks/posttool` | Добавить tool в `ProgressTracker`, debounce-edit прогресс-сообщения |

## Быстрый старт

Один раз на сервер:

```bash
sudo mkdir -p /opt/tg-bridge && sudo chown $USER:$USER /opt/tg-bridge
git clone https://github.com/izikwinner/tg-bridge.git /opt/tg-bridge
cd /opt/tg-bridge && bun install

# Под себя отредактируйте deploy/tg-bridge@.service:
#   - User=...
#   - все пути /home/agent/... → ваш домашний каталог
#   - путь к bun (найти: command -v bun)
sudo cp deploy/tg-bridge@.service deploy/tg-bridge.target /etc/systemd/system/
sudo systemctl daemon-reload
```

На каждый агент:

```bash
AGENT=myagent
PORT=9200

mkdir -p ~/.claude-lab/$AGENT/.claude/tg-bridge/{state,logs}

cat > ~/.claude-lab/$AGENT/.claude/tg-bridge/channel.env <<EOF
TELEGRAM_BOT_TOKEN=<токен от @BotFather>
TELEGRAM_BOT_ID=<id бота — число до двоеточия в токене>
TELEGRAM_ALLOWED_USER_IDS=<ваш user_id, узнать у @userinfobot>
TELEGRAM_ALLOWED_CHAT_IDS=<ваш user_id (= chat_id для лички)>
BRIDGE_HOST=127.0.0.1
BRIDGE_PORT=$PORT
BRIDGE_BEARER_TOKEN=$(openssl rand -hex 32)
TMUX_SOCKET=tgbridge-$AGENT
TMUX_SESSION=$AGENT
CLAUDE_BINARY=$HOME/.local/bin/claude
CLAUDE_FLAGS=--dangerously-skip-permissions
WORKSPACE=$HOME/.claude-lab/$AGENT/.claude
STATE_DIR=$HOME/.claude-lab/$AGENT/.claude/tg-bridge/state
LOG_DIR=$HOME/.claude-lab/$AGENT/.claude/tg-bridge/logs
OWNER_USER_IDS=<ваш user_id>
PERMISSION_DEFAULT=deny
QUEUE_MAX_DEPTH=100
STREAMING_MODE=progress
UPLOADS_TTL_DAYS=30
# опционально (голос):
# GROQ_API_KEY_FILE=$HOME/.secrets/groq-api-key
EOF

# Bearer token в отдельный файл — install-hooks.sh его подхватит
grep ^BRIDGE_BEARER_TOKEN= ~/.claude-lab/$AGENT/.claude/tg-bridge/channel.env \
  | cut -d= -f2 \
  | tr -d '\n' \
  > ~/.claude-lab/$AGENT/.claude/tg-bridge/state/.bearer
chmod 600 ~/.claude-lab/$AGENT/.claude/tg-bridge/state/.bearer

# Запустить tmux-сессию для агента (мост подключается к существующей)
tmux -L tgbridge-$AGENT new-session -d -s $AGENT -c $HOME/.claude-lab/$AGENT/.claude
tmux -L tgbridge-$AGENT send-keys -t $AGENT "claude --dangerously-skip-permissions" Enter

# Пропатчить settings.json агента хуками
bash /opt/tg-bridge/scripts/install-hooks.sh \
  --settings $HOME/.claude-lab/$AGENT/.claude/.claude/settings.json \
  --port $PORT \
  --token-file $HOME/.claude-lab/$AGENT/.claude/tg-bridge/state/.bearer

# Запустить
sudo systemctl enable --now tg-bridge@$AGENT.service
journalctl -u tg-bridge@$AGENT.service -f
```

Проверка: напишите боту что-нибудь в Telegram — должна появиться реакция 👀, прогресс-сообщение и финальный ответ.

## Переменные окружения (валидируются zod'ом)

| Переменная | По умолчанию | Заметки |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | токен Bot API |
| `TELEGRAM_BOT_ID` | — | числовой ID (должен совпадать с токеном) |
| `TELEGRAM_ALLOWED_USER_IDS` | — | CSV |
| `TELEGRAM_ALLOWED_CHAT_IDS` | — | CSV |
| `BRIDGE_HOST` | `127.0.0.1` | |
| `BRIDGE_PORT` | — | уникальный на каждый агент |
| `BRIDGE_BEARER_TOKEN` | — | для локальных `/hooks/*` |
| `TMUX_SOCKET`, `TMUX_SESSION` | — | соглашение: `tgbridge-<agent>` / `<agent>` |
| `CLAUDE_BINARY`, `CLAUDE_FLAGS` | … / `--dangerously-skip-permissions` | |
| `WORKSPACE` | — | cwd для `claude` |
| `STATE_DIR`, `LOG_DIR` | — | на каждый агент |
| `BUSINESS_API_ENABLED` | `false` | strictBool — `"false"` парсится корректно |
| `INJECT_SENDER_IDENTITY` | `false` | strictBool |
| `OWNER_USER_IDS` | падает в `ALLOWED_USER_IDS` | кто отвечает на permission-запросы |
| `PERMISSION_TIMEOUT_MS` | `50000` | укладывается в ~60-секундное окно хука Claude Code |
| `PERMISSION_DEFAULT` | `deny` | если оператор не ответил вовремя |
| `QUEUE_MAX_DEPTH` | `100` | при переполнении выкидывается самый старый |
| `BUSY_TIMEOUT_MS` | `300000` | force-IDLE (5 мин). Сбрасывается на каждом PreToolUse/PostToolUse и каждые 30 с при изменении пана. |
| `STREAMING_MODE` | `progress` | `off` / `partial` / `progress` |
| `GROQ_API_KEY_FILE` | _(нет)_ | путь к файлу с ключом Groq. Если не задан, голосовые сообщения игнорируются. |
| `UPLOADS_TTL_DAYS` | `30` | возраст файлов в `.tg-uploads/`, после которого они удаляются. `0` — никогда. |
| `DATABASE_URL_FILE` | _(нет)_ | путь к файлу с Postgres DSN. Если не задан — DB-зеркало отключено (только Telegram). |
| `AGENT_NAME` | `TMUX_SESSION` | имя агента для DB-зеркала. |

## Маркеры в ответе агента

Мост сканирует финальный ответ ассистента построчно на маркеры в конце строки и срезает их перед отправкой оператору.

| Маркер | Эффект |
|---|---|
| `[REACT:thumbsup]` | Ставит реакцию на исходное сообщение оператора. Slug маппится через `EMOJI_MAP` (`thumbsup`, `thumbsdown`, `heart`, `fire`, `eyes`, `hundred`, `clap`, `pray`, `ok`). Несколько маркеров складываются. |
| `[BUTTONS: Ha=yes \| Yo'q=no \| Boshqa]` | Отправляет ответ с inline-клавиатурой. Синтаксис `Label=payload`; голая метка использует себя как payload. До 8 кнопок. |
| `[FILE: /path/to/file caption="…" kind=photo\|video\|document\|voice]` | Отправляет файл. `kind` опционален — угадывается по расширению (`.jpg`/`.png` → photo, `.mp4`/`.mov` → video, `.ogg` → voice, остальное → document). |

## Разработка

```bash
bun install
bun test
bun run typecheck
bun run start
```

Тесты: `tests/**/*.test.ts` — чистая логика (config, FSM, очередь, parser, chunker, gate, policy, relay, tracker, mask, stop, http-server, markdown, parser, db). Интеграционный тест `tmux-session` занимает ~3 с.

## Подводные камни

- **Один оператор на агент** (FSM сериализует ходы). Map `lastInbound` ключевана по `chat_id` — мульти-чат работает, но in-flight turn один глобальный.
- **Реакции Telegram**: рендерятся только из bot-whitelist (👍 ❤ 🔥 👀 🙏 …). `✅ ❌ ⚠` возвращают `REACTION_INVALID` — используйте slug, который маппится в разрешённый эмодзи.
- **Прогресс-сообщение** нельзя редактировать после 48-часового окна Telegram. На обычных ходах не проблема (секунды), но если процесс висит дольше, финальный `done`-edit падает тихо.
- **Subagent (Task) внутренности** всё ещё невидимы — отслеживаем только parent-диспатч по `PreToolUse`/`PostToolUse`. Старый шлюз видел subagent `tool_use` блоки, потому что парсил `claude -p stream-json`; здесь нужен отдельный transcript-follower.
- **Голосовая транскрипция** идёт в `whisper-large-v3` у Groq. Стоит копейки за минуту, но каждое голосовое сообщение бьёт в API — если не нужно, не задавайте `GROQ_API_KEY_FILE`.

## Безопасность

- `--dangerously-skip-permissions` — Claude получает право выполнять команды без подтверждения. **Запускайте только на сервере, который вам не жалко** (или в VM/контейнере).
- `BRIDGE_BEARER_TOKEN` и `TELEGRAM_BOT_TOKEN` — секреты, не коммитьте в git и не показывайте.
- `TELEGRAM_ALLOWED_USER_IDS` обязательно ограничьте только своими ID, иначе любой посторонний сможет писать боту.
- Файлы `.bearer` и `channel.env` храните с правами `600` (`chmod 600`).

## Лицензия

Apache-2.0
