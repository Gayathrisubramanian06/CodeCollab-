# CodeCollab

A real-time collaborative code editor with AI-powered code review, inline autocomplete, and a built-in code execution terminal — all in the browser.

---

## Features

- **Real-time collaboration** — Multiple users edit the same file simultaneously using Yjs CRDTs (conflict-free sync via WebRTC)
- **AI code review** — Send your code to an LLM (Llama 3.3 via Groq) and get instant bug reports, fixes, and improvement suggestions
- **Ghost text autocomplete** — Copilot-style inline completions as you type, debounced for performance
- **Code execution** — Run Python and JavaScript locally from the browser; errors are automatically intercepted and sent to the AI for diagnosis
- **Diff viewer** — AI suggestions open a side-by-side Monaco diff editor; accept or reject before applying changes
- **Chat interface** — Persistent AI chat panel with slash commands (`/explain`, `/optimize`) and conversation history
- **GitHub OAuth** — Room access via Supabase GitHub login

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS |
| Editor | Monaco Editor, `y-monaco`, `y-webrtc`, Yjs |
| Backend | FastAPI (Python), Groq SDK |
| AI Model | Llama 3.3 70B (via Groq API) |
| Auth & DB | Supabase (GitHub OAuth) |
| Markdown | `react-markdown`, `rehype-highlight` |

---

## Project Structure

```
codecollab/
├── backend/
│   ├── main.py           # FastAPI server — WebSocket chat, autocomplete, code execution
│   └── requirements.txt
└── frontend/
    └── app/
        ├── page.tsx              # Landing page with GitHub login
        ├── room/[id]/page.tsx    # Main editor room
        └── components/
            ├── EditorLayout.tsx  # Editor + AI panel layout
            ├── AiPanel.tsx       # AI message panel component
            └── CollabEditor.tsx  # Yjs-bound Monaco editor
        └── lib/
            ├── syncEngine.ts     # Yjs + WebRTC sync setup
            └── debounce.ts       # Debounce utility
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- Python 3.10+
- A [Groq API key](https://console.groq.com/)
- A [Supabase](https://supabase.com/) project with GitHub OAuth enabled

---

### 1. Clone the repo

```bash
git clone https://github.com/SREENATH-065/codecollab
cd codecollab
```

### 2. Backend setup

```bash
cd backend
pip install -r requirements.txt
```

Create a `.env` file in the `backend/` folder:

```env
GROQ_API_KEY=your_groq_api_key_here
```

Start the backend:

```bash
uvicorn main:app --reload --port 8000
```

### 3. Frontend setup

```bash
cd frontend
npm install
```

Create a `.env.local` file in the `frontend/` folder:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Start the frontend:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Usage

1. Log in with GitHub
2. You'll be dropped into a shared room (`/room/test-123` by default)
3. Share the URL with collaborators — they join the same Yjs document instantly
4. Write code, hit **▶ Run Code** to execute, or **✨ Ask AI** to review
5. AI suggestions with code blocks include a **🔍 Review Changes** button that opens a diff view — accept or reject before applying

### Slash Commands (in the AI chat input)

| Command | Effect |
|---|---|
| `/explain <code>` | Step-by-step breakdown for beginners |
| `/optimize <code>` | Performance rewrite with Big O analysis |

---

## How the AI Works

- **Code review** — Full file or selected code is sent over WebSocket to the FastAPI backend, which streams a response from Llama 3.3 token by token back to the panel
- **Auto-fix on error** — When executed code throws a runtime error, the error log is automatically forwarded to the LLM as a background task; the fix streams into the AI panel without any user action
- **Autocomplete** — On every keystroke (debounced 400ms), the last 20 lines up to the cursor are sent to `/autocomplete`; the model returns only the immediate suffix characters

---

## Supported Languages (Code Execution)

| Language | Runtime |
|---|---|
| Python | Local `python` / `py` |
| JavaScript | Local `node` |

Other languages (HTML, CSS, Java, C++) are available for syntax highlighting but not yet wired to the execution engine.

---

## License

MIT
