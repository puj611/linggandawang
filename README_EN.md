# Linggan Dawang (灵感大王)

> Turn vague ideas into precise prompts — a local-first AI prompt generator.

English · [中文](./README.md)

A desktop floating-ball app that does **not** polish your prompts. Instead, it asks you **clarifying questions** and squeezes your half-formed idea into a structured prompt an AI coding agent can execute precisely. Local-first: fully usable with zero API keys.

## The Problem It Solves

The common struggle with AI coding tools (Claude Code, Cursor, Copilot, etc.): you have an idea but can't articulate it, AI "polishing" distorts it, and agents change the wrong things — or nothing at all. Linggan Dawang inverts the traditional polish flow:

| Traditional polish tools | Linggan Dawang |
|---|---|
| You write, AI rewrites | AI asks first, you answer |
| AI fills gaps with statistical defaults | AI exposes what you left unsaid, so you decide |
| Output: the AI's average | Output: your actual intent, structured |
| One big-shot action | Small aligned steps across rounds |

## Key Features

- **Guided Q&A clarification** — three scenario question banks (frontend UI / backend API / slides) plus a question state machine: routes and follows up round by round until your intent is complete
- **Local rule engine, works without any API key** — keyword routing + adjective-cluster fallback generate prompts out of the box; plug in an LLM (DeepSeek / Qwen / OpenAI-compatible / local Ollama) for intent analysis and smart follow-ups
- **Target-tool adaptation** — tailors prompt structure for Claude Code / Cursor / Copilot / Codex / generic (XML tags, file-path placeholders, step-by-step tasks with stop conditions)
- **Screenshot diagnosis** — paste a UI screenshot to decompose visual elements and pinpoint what feels "off"
- **Project scanning** — scans your local project into a fingerprint, so generated prompts carry real tech-stack and directory context
- **RAG history enhancement** — embeds past Q&A locally (all-MiniLM-L6-v2) and retrieves similar history to enrich context
- **Preference learning** — learns your answer tendencies and marks "recommended" options on recurring questions
- **MCP server** — built-in stdio MCP server exposing guided prompt generation to Claude Code / Cursor
- **Global hotkey + always-ready floating ball** — summon from any app; collapses to a ball when idle
- **Keyring secret storage** — API keys live in the OS credential manager (Windows Credential Manager, etc.), never on disk in plain files

## Comparison with Similar Projects

| | prompt-optimizer | Prompt Master | prompt-iterator | Linggan Dawang |
|---|---|---|---|---|
| Stars | 33.2k | ~10k | — | — |
| Form factor | Web / desktop / browser ext. / Docker | Claude skill | Web app | Desktop (Tauri) |
| Question-based clarification | ❌ one-shot rewrite | ⚠️ up to 3 questions | ✅ multi-round form | ✅ full question bank, multi-round |
| Usable without API key | ❌ LLM required | ✅ | ❌ LLM required | ✅ local rule engine fallback |
| Always-on desktop presence | ⚠️ desktop app, not resident | ❌ in-IDE | ❌ | ✅ floating ball + global hotkey |
| Target-tool adaptation | ⚠️ custom templates | ✅ 30+ tool profiles | ❌ | ✅ Claude Code / Cursor / Copilot / Codex / generic |
| MCP server | ❌ | ❌ | ❌ | ✅ stdio |
| Local data | ✅ encrypted local storage | ✅ | ⚠️ server-side processing | ✅ SQLite + keyring |

> Figures are a public-research snapshot from 2026-08; refer to each repository for current data. The comparison only covers dimensions relevant to this project: prompt-optimizer's before/after testing and template marketplace, Prompt Master's token auditing and 35 anti-pattern checks, and prompt-iterator's PDF/DOCX parsing are capabilities this project doesn't have yet and draws on.

## Installation

### Download from Releases

Grab the installer for your platform from the [Releases](../../releases) page:

| Platform | File |
|---|---|
| Windows | `.exe` (NSIS installer) |
| macOS (Apple Silicon / Intel) | `.dmg` |
| Linux | `.deb` / `.AppImage` |

### Build from Source

Requirements: Node.js ≥ 20, Rust stable, npm (the repo ships `package-lock.json` — use npm).

```bash
git clone <repo-url>
cd 灵感大王
npm install          # install frontend dependencies
npx tauri dev        # run in dev mode (starts Vite + desktop window)
npm run build        # build frontend into dist/
npx tauri build      # package installers into src-tauri/target/release/bundle/
```

> `tauri.conf.json` sets no `beforeBuildCommand`, so run `npm run build` explicitly before packaging.

## MCP Server

A built-in stdio MCP server exposes "guided prompt generation" to Claude Code / Cursor — no API key, pure local rule engine, zero network calls.

```bash
npm run mcp:build    # builds mcp-server/dist/index.js
```

Configure in Claude Code (project `.mcp.json`) or Cursor (`~/.cursor/mcp.json`):

```json
{ "mcpServers": { "linggan": { "command": "node", "args": ["/abs/path/to/linggandawang/mcp-server/dist/index.js"] } } }
```

Two tools are provided: `list_questions` (preview the questions that would be asked) and `generate_prompt` (pass a requirement description, optionally a target tool and preset answers, get back a structured prompt). See [docs/reference/mcp-server.md](./docs/reference/mcp-server.md) for full parameters, error conventions, and protocol details.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript 5 + Vite 5 + Tailwind CSS 3 |
| State | Zustand 4 |
| Desktop | Tauri 2 (Rust backend) |
| Storage | SQLite (tauri-plugin-sql, with migrations) + keyring (OS credential manager) |
| Embeddings | @xenova/transformers (all-MiniLM-L6-v2, local inference, lazy-loaded) |
| LLM (optional) | OpenAI-compatible adapter (DeepSeek / Qwen / OpenAI / local Ollama) |
| MCP | Hand-written JSON-RPC 2.0 stdio server, zero extra dependencies |

## Project Layout

```
├── src/
│   ├── engine/          # Core engine: question state machine, prompt generation, intent analysis, preference learning (pure logic, independently testable)
│   ├── hooks/           # React hooks orchestration layer (between UI and engine)
│   ├── stores/          # Zustand state layer
│   ├── lib/             # Infrastructure: LLM adapter, SQLite, vector store
│   ├── components/      # UI components
│   └── question-bank/   # Three scenario question banks (YAML)
├── src-tauri/           # Rust command layer: key proxying, project scanning, window management, SQLite migrations
├── mcp-server/          # MCP stdio server (reuses pure logic from src/engine)
├── docs/reference/      # API docs: MCP server, LLM adapter, Tauri commands
└── .github/workflows/   # CI and Release
```

## Development

```bash
npm run dev                        # Vite dev server
npx tauri dev                      # Tauri dev mode
npm test                           # vitest unit tests
npm run lint                       # ESLint
npx tsc --noEmit                   # TypeScript typecheck
cd src-tauri && cargo check        # Rust compile check
npm run mcp:smoke                  # MCP stdio smoke test
```

See [AGENTS.md](./AGENTS.md) for layering constraints, coding conventions, and known pitfalls; see [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution process.

## License

[MIT](./LICENSE)
