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
2. **Formatting:** Always wrap code in Markdown triple backticks. Use **bold** for file names, function names, and variable names ONLY in conversational text. **NEVER use markdown formatting like `**` inside the triple-backtick code blocks.** Code blocks must be clean and valid.
3. **Mode A (Code Review):** If the user sends a code snippet, structure the response exactly like this:
   - 🐛 **Bugs Found:** (list bugs)
   - 💡 **Fix:** (code block)
   - ⚡ **Improvements:** (efficiency tips)
   (If there are zero bugs and no question, say "✅ No bugs found.")

4. **Mode B (Questions/Commands):** If the user asks a question, gives a command (like 'explain'), or follows up on previous code, answer directly and concisely using your memory of the conversation.

5. **Context:** You have access to the conversation history. Use it to understand what the user is referring to.
"""

# Create a global store for active rooms
# Format: { room_id: { "clients": set(), "history": [] } }
active_rooms = {}

@app.websocket("/ws/chat/{room_id}")
async def analyze_code(websocket: WebSocket, room_id: str):
    # --- WebSocket Security Handshake ---
    origin = websocket.headers.get("origin")
    allowed_origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000"
    ]

    if origin not in allowed_origins and origin is not None:
        await websocket.close(code=1008)
        return

    await websocket.accept()
    
    # Initialize room if it doesn't exist
    if room_id not in active_rooms:
        active_rooms[room_id] = {
            "clients": set(),
            "history": []
        }
    
    # Add client to the room
    active_rooms[room_id]["clients"].add(websocket)
    print(f"✅ User joined AI room: {room_id}. Total clients: {len(active_rooms[room_id]['clients'])}")

    try:
        while True:
            code = await websocket.receive_text()
            room = active_rooms[room_id]
            
            # --- FEATURE 1: CLEAR COMMAND ---
            if code.strip().upper() == "CLEAR":
                room["history"].clear()
                # Broadcast clear to everyone in the room
                for ws_client in list(room["clients"]):
                    try:
                        await ws_client.send_text("🗑️ **Chat history cleared.** Fresh start!")
                    except Exception:
                        pass
                print(f"🗑️ History wiped for room {room_id}.")
                continue

            print(f"📨 Received snippet in {room_id}: {len(code)} characters")

            current_system_prompt = SYSTEM_PROMPT 
            
            if code.strip().startswith("/explain"):
                current_system_prompt = "You are a helpful coding teacher. Break down the provided code or concept step-by-step for a beginner. Use simple terms. Do not just look for bugs."
                code = code.replace("/explain", "").strip() 
                
            elif code.strip().startswith("/optimize"):
                current_system_prompt = "You are a performance optimization expert. Rewrite the provided code to make it execute faster and use less memory. Briefly explain why your version is better and mention Big O notation."
                code = code.replace("/optimize", "").strip()

            # Add to room history
            room["history"].append({"role": "user", "content": code})
            
            # Broadcast "Analyzing" status to all clients
            for ws_client in list(room["clients"]):
                try:
                    await ws_client.send_text("⚙️ **Analyzing context and code...**")
                except Exception:
                    pass

            # Broadcast [START]
            for ws_client in list(room["clients"]):
                try:
                    await ws_client.send_text("[START]") 
                except Exception:
                    pass

            chat_completion = client.chat.completions.create(
                messages=[
                    {"role": "system", "content": current_system_prompt},
                    *room["history"][-10:]
                ],
                model="llama-3.3-70b-versatile",
                stream=True
            )

            full_response = ""
            for chunk in chat_completion:
                if chunk.choices[0].delta.content:
                    text_chunk = chunk.choices[0].delta.content
                    full_response += text_chunk
                    
                    # Broadcast chunk
                    for ws_client in list(room["clients"]):
                        try:
                            await ws_client.send_text(text_chunk)
                        except Exception:
                            room["clients"].discard(ws_client)

            # Broadcast [END]
            for ws_client in list(room["clients"]):
                try:
                    await ws_client.send_text("[END]")
                except Exception:
                    room["clients"].discard(ws_client)

            # Save full_response to room history
            room["history"].append({"role": "assistant", "content": full_response})
            print(f"🧠 AI streaming chunk finished for {room_id}.")

    except WebSocketDisconnect:
        # Remove client on disconnect
        if websocket in active_rooms.get(room_id, {}).get("clients", set()):
            active_rooms[room_id]["clients"].remove(websocket)
            print(f"❌ User left AI room {room_id}. Total clients: {len(active_rooms[room_id]['clients'])}")
            
            # Cleanup empty rooms
            if not active_rooms[room_id]["clients"]:
                del active_rooms[room_id]
                print(f"🧹 Room {room_id} has been cleaned up.")
    except Exception as e:
        print(f"⚠️ Error: {str(e)}")
        for ws_client in list(active_rooms.get(room_id, {}).get("clients", [])):
            try:
                await ws_client.send_text(f"❌ **AI Error:** {str(e)}")
            except Exception:
                pass

@app.get("/")
def root():
    return {"status": "Python Brain is alive 🧠"}