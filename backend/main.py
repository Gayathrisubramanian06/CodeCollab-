from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from groq import Groq
import os

# Load the .env file
load_dotenv()

app = FastAPI()

# CORS — allow frontend to talk to backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create the Groq client using your API key
client = Groq(api_key=os.getenv("GROQ_API_KEY"))


@app.websocket("/ws/analyze")
async def analyze_code(websocket: WebSocket):
    await websocket.accept()
    print("✅ Frontend connected!")

    try:
        while True:
            # 1. Receive code from the frontend
            code = await websocket.receive_text()
            print(f"📨 Received code:\n{code}")

            # 2. Send the code to Groq AI
            await websocket.send_text("🤖 Analyzing your code...")

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
                model="llama3-8b-8192",  # fast free model on Groq
            )

            # 3. Extract the AI's response
            ai_response = chat_completion.choices[0].message.content
            print(f"🧠 AI Response:\n{ai_response}")

            # 4. Send the AI response back to the frontend
            await websocket.send_text(ai_response)

    except WebSocketDisconnect:
        print("❌ Frontend disconnected.")


# Health check
@app.get("/")
def root():
    return {"status": "Python Brain is alive 🧠"}