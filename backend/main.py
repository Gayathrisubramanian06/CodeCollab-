from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# 1. THE VIP LIST (Fixes the 403 Connection Rejected Error)
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins, 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. HEALTH CHECK
@app.get("/")
def read_root():
    return {"status": "AI Brain is online! 🧠"}

# 3. THE WEBSOCKET PIPELINE (Must match the Next.js connection string exactly)
@app.websocket("/ws/chat")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("✅ Frontend connected to AI Brain!")
    
    try:
        while True:
            # Wait for code to arrive from the frontend
            user_code = await websocket.receive_text()
            print(f"📨 Received code snippet: {len(user_code)} characters")
            
            # Send the Echo response back (Proves the bridge works)
            response_message = f"[ECHO] AI received your code! It starts with: {user_code[:30]}..."
            await websocket.send_text(response_message)
            
    except WebSocketDisconnect:
        print("❌ Frontend disconnected.")