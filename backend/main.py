from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
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

1. **Tone:** Be extremely concise. No greetings like 'Hello' or 'Sure!'.
2. **Formatting:** Always wrap code in Markdown triple backticks. Use **bold** for file names, function names, and variable names.
3. **Mode A (Code Review):** If the user sends a code snippet, structure the response exactly like this:
   - 🐛 **Bugs Found:** (list bugs)
   - 💡 **Fix:** (code block)
   - ⚡ **Improvements:** (efficiency tips)
   (If there are zero bugs and no question, say "✅ No bugs found.")

4. **Mode B (Questions/Commands):** If the user asks a question, gives a command (like 'explain'), or follows up on previous code, answer directly and concisely using your memory of the conversation.

5. **Context:** You have access to the conversation history. Use it to understand what the user is referring to.
"""


# ── Autocomplete endpoint ────────────────────────────────────────────────────

class AutocompleteRequest(BaseModel):
    code: str
    language: str = "javascript"


@app.post("/autocomplete")
async def autocomplete(req: AutocompleteRequest):
    """
    Ultra-fast inline ghost-text completion.
    Returns ONLY raw code — no markdown, no explanation.
    """
    prompt = f"""You are an advanced Copilot-style code completion engine. Your task is to output the EXACT next few lines of code to continue the user's snippet.
Do not output anything else.

CRITICAL RULES:
1. ONLY return the next 1-3 lines of code.
2. DO NOT repeat the code that is already written above. Only output what comes NEXT.
3. DO NOT output any conversational text.
4. DO NOT wrap the output in markdown code blocks.

Language: {req.language}

Code so far:
{req.code}

# COMPLETION (Continuing exactly where the code above left off):
"""

    response = client.chat.completions.create(
        messages=[{"role": "user", "content": prompt}],
        model="llama-3.1-8b-instant",
        max_tokens=60,
        temperature=0.1,
        stop=["\n\n", "```", "<|eot_id|>"],
    )

    completion = response.choices[0].message.content
    if not completion:
        return {"completion": ""}

    # Clean up formatting hallucinations
    completion = completion.replace("```" + req.language, "").replace("```", "").strip()

    # If the LLM repeated the exact last line of the prompt, strip it out
    last_line = req.code.rstrip().split('\n')[-1].strip()
    if last_line and completion.startswith(last_line):
        completion = completion[len(last_line):].lstrip('\r\n')

    return {"completion": completion}


# ── WebSocket chat / review endpoint ────────────────────────────────────────

@app.websocket("/ws/chat")
async def analyze_code(websocket: WebSocket):
    origin = websocket.headers.get("origin")
    allowed_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000"
    ]

    if origin not in allowed_origins and origin is not None:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    print("✅ AI Brain Linked: Frontend connected!")

    conversation_history = []

    try:
        while True:
            code = await websocket.receive_text()

            # CLEAR command
            if code.strip().upper() == "CLEAR":
                conversation_history.clear()
                await websocket.send_text("🗑️ **Chat history cleared.** Fresh start!")
                await websocket.send_text("[END]")
                print("🗑️ History wiped for this session.")
                continue

            print(f"📨 Received snippet: {len(code)} characters")

            # Slash command router
            current_system_prompt = SYSTEM_PROMPT

            if code.strip().startswith("/explain"):
                current_system_prompt = "You are a helpful coding teacher. Break down the provided code or concept step-by-step for a beginner. Use simple terms. Do not just look for bugs."
                code = code.replace("/explain", "").strip()

            elif code.strip().startswith("/optimize"):
                current_system_prompt = "You are a performance optimization expert. Rewrite the provided code to make it execute faster and use less memory. Briefly explain why your version is better and mention Big O notation."
                code = code.replace("/optimize", "").strip()

            # Add to history
            conversation_history.append({
                "role": "user",
                "content": code
            })

            # Signal to frontend that stream is starting
            await websocket.send_text("[START]")

            # ── Streaming call to Groq ──────────────────────────────────────
            stream = client.chat.completions.create(
                messages=[
                    {"role": "system", "content": current_system_prompt},
                    *conversation_history[-10:]
                ],
                model="llama-3.3-70b-versatile",
                stream=True,
            )

            full_response = ""

            for chunk in stream:
                token = chunk.choices[0].delta.content

                if token is not None:
                    full_response += token
                    await websocket.send_text(token)

            # Signal to frontend that stream is complete
            await websocket.send_text("[END]")

            # Save full response to memory
            conversation_history.append({
                "role": "assistant",
                "content": full_response
            })

            print(f"🧠 Full streamed response sent ({len(full_response)} chars)")

    except WebSocketDisconnect:
        print("❌ Frontend disconnected.")
    except Exception as e:
        print(f"⚠️ Error: {str(e)}")
        try:
            await websocket.send_text(f"❌ **AI Error:** {str(e)}")
            await websocket.send_text("[END]")
        except:
            pass


@app.get("/")
def root():
    return {"status": "Python Brain is alive 🧠"}