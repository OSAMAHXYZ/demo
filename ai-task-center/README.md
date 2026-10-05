# AI Task Automation Center

Local automation workspace. You record structured browser actions once, turn them into a workflow, schedule it, and the server runs it with Playwright.

## Run

From `ai-task-center`:

```
npm install
npm run dev
npm run dev:client
```

API: `http://127.0.0.1:8788`  
App: `http://127.0.0.1:5174`

Copy `.env.example` to `.env` when you want a model. Without `AI_API_KEY`, analysis is a deterministic converter and the screen says so.

Install the browser before recording or running:

```
npx playwright install chromium
```

Run that inside `ai-task-center/server`.

## What is real

- SQLite stores tasks, steps, recordings, schedules, runs, screenshots, and encrypted credentials.
- Schedules reload from the database on startup. Default timezone is `Asia/Riyadh`.
- A run lock stops the same schedule window from executing twice.
- The runner only performs the listed action types. Addresses must be `http` or `https`. Uploads stay inside that task's download folder.
- Passwords are encrypted with AES-256-GCM. The key is `APP_SECRET` or `server/data/secret.key`.
- If a click target is missing, the runner tries selector fallbacks, then a similarity match (or the configured model) before failing.
- `Open Example Website` is seeded so Run Now can open `https://example.com`.

## External requirements

- Headed recording needs a desktop session. Set `RECORD_HEADLESS=true` only for unattended capture tests.
- An OpenAI-compatible chat endpoint is optional. Set `AI_BASE_URL`, `AI_API_KEY`, and `AI_MODEL`.
- The API listens on `127.0.0.1`. Put an authenticated reverse proxy in front of it before exposing it on a network.
- Email, Teams, and Slack are not wired. In-app notifications are stored in the database.
- PostgreSQL and S3 are not connected. The SQL is plain and screenshots are files under `server/data`, so those stores can replace SQLite and the local folder later.
