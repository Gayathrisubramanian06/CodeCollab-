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
            # 1. Receive raw code or text from frontend
            code = await websocket.receive_text()
            
            # --- FEATURE 1: CLEAR COMMAND ---
            if code.strip().upper() == "CLEAR":
                conversation_history.clear()
                await websocket.send_text("🗑️ **Chat history cleared.** Fresh start!")
                print("🗑️ History wiped for this session.")
                continue

            print(f"📨 Received snippet: {len(code)} characters")

            # --- FEATURE 2: SLASH COMMAND ROUTER ---
            # Default to our standard bug-finding SYSTEM_PROMPT
            current_system_prompt = SYSTEM_PROMPT 
            
            # Change personality dynamically based on commands
            if code.strip().startswith("/explain"):
                current_system_prompt = "You are a helpful coding teacher. Break down the provided code or concept step-by-step for a beginner. Use simple terms. Do not just look for bugs."
                # Strip the command out so the AI only sees the actual code/question
                code = code.replace("/explain", "").strip() 
                
            elif code.strip().startswith("/optimize"):
                current_system_prompt = "You are a performance optimization expert. Rewrite the provided code to make it execute faster and use less memory. Briefly explain why your version is better and mention Big O notation."
                # Strip the command out
                code = code.replace("/optimize", "").strip()

            # --- MEMORY LOGIC ---
            # Add the raw (but stripped) code/text to the user's history
            conversation_history.append({
                "role": "user", 
                "content": code 
            })

            # Notify UI that work is happening
            await websocket.send_text("⚙️ **Analyzing context and code...**")

            # --- Call Groq with full history (Memory) ---
            chat_completion = client.chat.completions.create(
                messages=[
                    # CRITICAL: We pass the 'current_system_prompt' here instead of the global one!
                    {"role": "system", "content": current_system_prompt},
                    *conversation_history[-10:] # Send the last 10 messages for context
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