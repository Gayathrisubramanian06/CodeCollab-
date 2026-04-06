from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from groq import Groq
import os

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

SYSTEM_PROMPT = """You are a senior pair programmer and code reviewer. Follow these rules strictly:

1. Be extremely concise. No greetings like 'Hello', 'Sure!', 'Great question' or filler words. Get straight to the point.
2. Always wrap code suggestions in Markdown triple backticks with a language tag. Example:
```python
# your code here
```
3. Use **bold** for every file name, function name, and variable name. Example: **main.py**, **handleSubmit()**.
4. Structure every response like this:
   - 🐛 **Bugs Found:** (list each bug)
   - 💡 **Fix:** (show corrected code in backticks)
   - ⚡ **Improvements:** (optional, only if relevant)
5. If there are no bugs, say: "✅ No bugs found." and stop.
"""


@app.websocket("/ws/chat")
async def analyze_code(websocket: WebSocket):

    origin = websocket.headers.get("origin")
    allowed_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000"
    ]

    if origin not in allowed_origins:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    print("✅ Frontend connected!")

    # ── Per-connection history (NOT global — each user gets their own) ──────
    conversation_history = []

    try:
        while True:
            code = await websocket.receive_text()
            print(f"📨 Received: {code[:80]}...")

            # CLEAR command
            if code.strip().upper() == "CLEAR":
                conversation_history.clear()
                await websocket.send_text("🗑️ Chat history cleared. Fresh start!")
                print("🗑️ History cleared for this connection.")
                continue

            # Add to this connection's history
            conversation_history.append({
                "role": "user",
                "content": f"Review this code and find bugs:\n\n{code}"
            })

            # Notify frontend
            await websocket.send_text("⚙️ Reviewing your code...")

            # Call Groq
            chat_completion = client.chat.completions.create(
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    *conversation_history
                ],
                model="llama-3.3-70b-versatile",
            )

            ai_response = chat_completion.choices[0].message.content
            conversation_history.append({
                "role": "assistant",
                "content": ai_response
            })

            print(f"🧠 AI Response:\n{ai_response}")
            await websocket.send_text(ai_response)

    except WebSocketDisconnect:
        print("❌ Frontend disconnected.")


@app.get("/")
def root():
    return {"status": "Python Brain is alive 🧠"}
