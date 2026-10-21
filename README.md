# AIDEN · DeepSeek Mix v2

One self-contained folder: local Python server, new browser UI, and Vercel
serverless handlers. The persona file is bundled at the root and inside `api/`.

## What changed

- **AIDEN identity** throughout `prompt.txt` and the fallback identity.
- **New UI** in `public/`: sidebar workspace, responsive chat, light/dark theme,
  copy buttons, context meter, mobile drawer, jump-to-latest.
- **No reasoning leak**: the local server filters `reasoning_content` out of the
  SSE stream, and the Vercel handler sends only the answer channel. The browser
  never renders a thinking panel.
- **More user context**: up to 32 recent turns are sent by the UI; the server
  accepts up to 40 messages / 80,000 characters and trims oldest-first.
- **Self-contained prompt loading**: `server.py` falls back to `prompt.txt` in
  this folder, so the site does not depend on `~/prom.txt`.

## Run locally

```bash
cd ~/deepseek-mix-v2
./start.sh
```

The site runs at **http://127.0.0.1:3000**. If another process already owns
port 3000, change `PORT` in `.env` to a free port and restart.

Without `start.sh`:

```bash
cd ~/deepseek-mix-v2
python3 server.py
```

## Deploy to Vercel

```bash
cd ~/deepseek-mix-v2
vercel --prod
```

Framework preset: **Other**. No build step. `vercel.json` bundles
`api/prompt.txt` with the functions.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `LLM_BASE_URL` | `https://text.pollinations.ai/openai` | OpenAI-compatible endpoint |
| `LLM_MODEL` | `openai-fast` | Model ID |
| `LLM_API_KEY` | empty | Server-side bearer token |
| `MAX_TOKENS` | `12000` | Requested cap (upstream may cap lower) |
| `TEMPERATURE` | `0.7` | 0–2 |
| `UNFILTERED` | `1` | Refusal retry with continuation seed |
| `NO_REASONING` | `1` | Strip private reasoning from the browser stream |
| `RATE_LIMIT` | `1000` | Requests per IP per window |
| `RATE_WINDOW` | `300` | Window in seconds |

For a genuinely stronger model, set a real provider key. Example:

```env
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat
LLM_API_KEY=sk-...
```

## Keep the prompt in sync

There are two copies because Vercel bundles the API function separately:

- `prompt.txt` — local server
- `api/prompt.txt` — Vercel function

After editing one, copy it to the other:

```bash
cp prompt.txt api/prompt.txt
```

## Notes

- The free Pollinations tier allows **one reply every 30 seconds per IP** and
  caps output around 1,500 tokens. On Vercel all visitors share the function's
  egress IP, so a public deployment needs a pollen key or another provider.
- `public/` serves at the site root. Local `server.py` serves the same files.
- The browser stores chat history in `localStorage` under `aiden.chat.v2`.
  Reasoning is never stored or rendered.
