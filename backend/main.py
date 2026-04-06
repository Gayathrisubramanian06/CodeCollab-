from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# Allow your Next.js frontend to talk to this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Echo WebSocket Endpoint ---
@app.websocket("/ws/analyze")
async def analyze_code(websocket: WebSocket):
    await websocket.accept()   # 1. Accept the incoming connection
    print("✅ Frontend connected!")

    try:
        while True:
            # 2. Wait for code to arrive from the frontend
            code = await websocket.receive_text()
            print(f"📨 Received code:\n{code}")

            # 3. Send a dummy response back (proves the bridge works)
            dummy_response = f"[ECHO] I received {len(code)} characters of code."
            await websocket.send_text(dummy_response)

    except WebSocketDisconnect:
        print("❌ Frontend disconnected.")


# --- Health Check ---
@app.get("/")
def root():
    return {"status": "Python Brain is alive 🧠"}