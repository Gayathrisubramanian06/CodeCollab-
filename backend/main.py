from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from groq import Groq
import os

# 1. Load Environment Variables (Ensure GROQ_API_KEY is in your .env)
load_dotenv()

app = FastAPI()

# 2. CORS Middleware (Global security)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. Initialize Groq Client
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# 4. The "Pro" System Prompt (Tuned for readability and speed)
SYSTEM_PROMPT = """You are a senior pair programmer and code reviewer. Follow these rules strictly:

1. Be extremely concise. No greetings like 'Hello' or 'Sure!'. Get straight to the bugs.
2. Always wrap code suggestions in Markdown triple backticks with a language tag. 
3. Use **bold** for every file name, function name, and variable name.
4. Structure every response exactly like this:
   - 🐛 **Bugs Found:** (list bugs)
   - 💡 **Fix:** (code block)
   - ⚡ **Improvements:** (efficiency tips)
5. If there are no bugs, say: "✅ No bugs found." and stop.
"""

@app.websocket("/ws/chat")
async def analyze_code(websocket: WebSocket):
    # --- WebSocket Security Handshake ---
    origin = websocket.headers.get("origin")
    allowed_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000"
    ]

    # Close connection if it's not from our React app
    if origin not in allowed_origins and origin is not None:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    print("✅ AI Brain Linked: Frontend connected!")

    # --- Per-Connection Memory ---
    # This list lives as long as the WebSocket is open (one browser tab)
    conversation_history = []

    try:
        while True:
            # Receive raw code or text from frontend
            code = await websocket.receive_text()
            
            # --- FEATURE: CLEAR COMMAND ---
            if code.strip().upper() == "CLEAR":
                conversation_history.clear()
                await websocket.send_text("🗑️ **Chat history cleared.** Fresh start!")
                print("🗑️ History wiped for this session.")
                continue

            print(f"📨 Received snippet: {len(code)} characters")

            # Add user's code to history
            conversation_history.append({
                "role": "user", 
                "content": f"Review this code and find bugs:\n\n{code}"
            })

            # Notify UI that work is happening
            await websocket.send_text("⚙️ **Analyzing context and code...**")

            # --- Call Groq with full history (Memory) ---
            # We combine System Prompt + User History
            chat_completion = client.chat.completions.create(
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    *conversation_history[-10:] # Send only the last 10 exchanges to save speed
                ],
                model="llama-3.3-70b-versatile",
            )

            # Extract AI response
            ai_response = chat_completion.choices[0].message.content
            
            # Add AI response to history so it remembers for the next message
            conversation_history.append({
                "role": "assistant", 
                "content": ai_response
            })

            # Send back to Developer A's UI
            await websocket.send_text(ai_response)
            print("🧠 AI response sent.")

    except WebSocketDisconnect:
        print("❌ Frontend disconnected.")
    except Exception as e:
        print(f"⚠️ Error: {str(e)}")
        # Try to send the error to the UI so the user knows why it failed
        try:
            await websocket.send_text(f"❌ **AI Error:** {str(e)}")
        except:
            pass

@app.get("/")
def root():
    return {"status": "Python Brain is alive 🧠"}