from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from groq import Groq
import os

# Load the .env file
load_dotenv()

app = FastAPI()

# 1. EXPANDED CORS: Added 127.0.0.1 and '*' to stop the 403 bouncer
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "*", 
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create the Groq client
client = Groq(api_key=os.getenv("GROQ_API_KEY"))

# 2. MATCHED ENDPOINT: Changed from /ws/analyze to /ws/chat to match your frontend!
@app.websocket("/ws/chat")
async def analyze_code(websocket: WebSocket):
    # Accept the connection explicitly
    await websocket.accept()
    print("✅ Frontend connected to AI Brain!")

    try:
        while True:
            # 1. Receive code from the frontend
            code = await websocket.receive_text()
            print(f"📨 Received code snippet: {len(code)} chars")

            # 2. Optional: Send an immediate "Thinking" message
            await websocket.send_text("🤖 Analyzing your code...")

            # 3. Send the code to Groq AI
            chat_completion = client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "You are an expert code reviewer. Review the code and find bugs, suggest improvements, and explain issues clearly."
                    },
                    {
                        "role": "user",
                        "content": f"Review this code and find bugs:\n\n{code}"
                    }
                ],
                model="llama-3.3-70b-versatile",
            )

            # 4. Extract the AI's response
            ai_response = chat_completion.choices[0].message.content
            print(f"🧠 AI Response generated")

            # 5. Send the AI response back to the frontend
            await websocket.send_text(ai_response)

    except WebSocketDisconnect:
        print("❌ Frontend disconnected.")
    except Exception as e:
        print(f"⚠️ Error: {e}")
        await websocket.close()

# Health check
@app.get("/")
def root():
    return {"status": "Python Brain is alive 🧠"}