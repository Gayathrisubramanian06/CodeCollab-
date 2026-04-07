from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
from groq import Groq
import os
import subprocess
import tempfile
from fastapi import BackgroundTasks

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
2. **Formatting:** Always wrap code in Markdown triple backticks. Use **bold** for file names and function names ONLY.
3. **CRITICAL:** NEVER use **bold** or any formatting markers INSIDE a triple-backtick code block. For example, use result = 1 + 2 instead of **result** = 1 + 2.
4. **Mode A (Code Review):** If the user sends a code snippet, structure the response exactly like this:
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
    system_instruction = f"""You are a strict inline code completion wrapper for {req.language}.
Your ONLY task is to predict the characters that belong EXACTLY after the user's cursor.

CRITICAL RULES:
1. ONLY output the immediate suffix. NEVER repeat what the user has already written on the current line!
2. If the user is mid-word or mid-line, output ONLY the remaining characters.
   - Example 1: User types `def ad`, you output `d(a, b):`
   - Example 2: User types `a=int(in`, you output `put())`
3. DO NOT wrap output in Markdown.
4. No conversational text whatsoever.
"""

    response = client.chat.completions.create(
        messages=[
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": req.code}
        ],
        model="llama-3.3-70b-versatile",
        max_tokens=30,
        temperature=0.1,
        stop=["\n\n", "```"],
    )

    completion = response.choices[0].message.content
    if not completion:
        return {"completion": ""}

    completion = completion.replace("```" + req.language, "").replace("```", "").strip()
    
    if completion.startswith("Here is") or completion.startswith("This is"):
        return {"completion": ""}

    last_line = req.code.split('\n')[-1]
    
    # ── AGGRESSIVE PREFIX STRIPPING ──
    # If the LLM still hallucinates the prefix, strip the overlapping text completely
    for i in range(len(last_line), 2, -1):
        suffix = last_line[-i:]
        if completion.startswith(suffix):
            completion = completion[i:]
            break

    # Strip if LLM ignored space rules and matched ignoring spaces
    import re
    clean_last = re.sub(r'\s+', '', last_line)
    clean_comp = re.sub(r'\s+', '', completion)
    
    if len(clean_last) > 3 and clean_comp.startswith(clean_last):
        matched_chars = 0
        cut_index = 0
        for i, char in enumerate(completion):
            if not char.isspace():
                matched_chars += 1
            if matched_chars == len(clean_last):
                cut_index = i + 1
                break
        completion = completion[cut_index:]

    return {"completion": completion}


active_rooms = {}

class ExecuteRequest(BaseModel):
    code: str
    language: str
    room_id: str

async def trigger_auto_fix(room_id: str, code: str, error_log: str):
    room = active_rooms.get(room_id)
    if not room or not room["clients"]:
        return

    prompt = f"The user executed the following code but it threw an error.\n\nCODE:\n{code}\n\nERROR LOG:\n{error_log}\n\nExplain the error concisely, and provide the fixed code. Follow previous formatting rules."
    
    # Broadcast analyzing status
    for ws_client in list(room["clients"]):
        try:
            await ws_client.send_text("⚙️ **Auto-Fix Interceptor Initialized...**")
            await ws_client.send_text("[START]")
        except Exception:
            pass
            
    try:
        stream = client.chat.completions.create(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                *room["history"][-10:],
                {"role": "user", "content": prompt}
            ],
            model="llama-3.3-70b-versatile",
            stream=True
        )
        
        full_response = ""
        for chunk in stream:
            token = chunk.choices[0].delta.content
            if token is not None:
                full_response += token
                for ws_client in list(room["clients"]):
                    try:
                        await ws_client.send_text(token)
                    except:
                        pass
                        
        for ws_client in list(room["clients"]):
            try:
                await ws_client.send_text("[END]")
            except Exception:
                pass
                
        room["history"].append({"role": "user", "content": prompt})
        room["history"].append({"role": "assistant", "content": full_response})
    except Exception as e:
        for ws_client in list(room["clients"]):
            try:
                await ws_client.send_text(f"❌ **Auto-Fix Error:** {str(e)}")
                await ws_client.send_text("[END]")
            except:
                pass

import asyncio

def run_local_code(cmd_parts):
    """Synchronous wrapper for subprocess, to be run in a thread."""
    return subprocess.run(cmd_parts, capture_output=True, text=True, timeout=10, errors='replace')

@app.post("/execute")
async def execute_code(req: ExecuteRequest, background_tasks: BackgroundTasks):
    try:
        # Map the frontend language to a local extension
        lang_map = {
            "javascript": { "ext": ".js", "cmd": "node" },
            "js": { "ext": ".js", "cmd": "node" },
            "python": { "ext": ".py", "cmd": "python" }
        }
        
        config = lang_map.get(req.language.lower())
        if not config:
            return {"output": f"Error: Language '{req.language}' is not supported for local execution yet.", "error": True}

        ext = config["ext"]
        primary_cmd = config["cmd"]

        # 1. Create a safe temporary file
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False, mode="w", encoding="utf-8") as f:
            f.write(req.code)
            temp_path = f.name
            
        # 2. Command detection (for Windows 'python' vs 'py')
        final_cmd = primary_cmd
        if primary_cmd == "python":
            if os.system("python --version > NUL 2>&1") != 0:
                final_cmd = "py"

        cmd_parts = [final_cmd, temp_path]
        
        try:
            # 3. Use to_thread to keep the async loop alive while running the subprocess
            result = await asyncio.to_thread(run_local_code, cmd_parts)
            stdout = result.stdout.strip()
            stderr = result.stderr.strip()
            code_exit = result.returncode
        except subprocess.TimeoutExpired:
            return {"output": f"Timeout Error: {req.language} code took too long to run (>10s).", "error": True}
        finally:
            if os.path.exists(temp_path):
                try: os.remove(temp_path)
                except: pass
        
        # 4. Handle results
        has_error = (code_exit != 0 and code_exit is not None) or len(stderr) > 0
        
        if has_error:
            # Dispatch async AI Auto-Fix
            background_tasks.add_task(trigger_auto_fix, req.room_id, req.code, stderr if stderr else stdout)
            
        output_res = stdout
        if stderr:
             output_res = stdout + "\n" + stderr if stdout else stderr
             
        return {
            "output": output_res if output_res else "Success (Process finished with no output)", 
            "error": has_error,
            "engine": f"Local {req.language} Engine ({final_cmd})"
        }
    except Exception as e:
        import traceback
        print(f"DEBUG EXECUTE ERROR:\n{traceback.format_exc()}")
        return {"output": f"Execution Engine Error: {str(e)}", "error": True}


# ── WebSocket chat / review endpoint ────────────────────────────────────────

@app.websocket("/ws/chat/{room_id}")
async def analyze_code(websocket: WebSocket, room_id: str):
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

    if room_id not in active_rooms:
        active_rooms[room_id] = {"clients": set(), "history": []}
    
    room = active_rooms[room_id]
    room["clients"].add(websocket)
    
    try:
        while True:
            code = await websocket.receive_text()

            if code.strip().upper() == "CLEAR":
                room["history"].clear()
                for ws_client in list(room["clients"]):
                    try:
                        await ws_client.send_text("🗑️ **Chat history cleared.** Fresh start!")
                        await ws_client.send_text("[END]")
                    except:
                        pass
                print(f"🗑️ History wiped for {room_id}.")
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

            room["history"].append({"role": "user", "content": code})

            for ws_client in list(room["clients"]):
                try:
                    await ws_client.send_text("⚙️ **Analyzing context and code...**")
                    await ws_client.send_text("[START]")
                except:
                    pass

            stream = client.chat.completions.create(
                messages=[
                    {"role": "system", "content": current_system_prompt},
                    *room["history"][-10:]
                ],
                model="llama-3.3-70b-versatile",
                stream=True,
            )

            full_response = ""
            for chunk in stream:
                token = chunk.choices[0].delta.content
                if token is not None:
                    full_response += token
                    for ws_client in list(room["clients"]):
                        try:
                            await ws_client.send_text(token)
                        except:
                            pass

            for ws_client in list(room["clients"]):
                try:
                    await ws_client.send_text("[END]")
                except:
                    pass

            room["history"].append({"role": "assistant", "content": full_response})

    except WebSocketDisconnect:
        if websocket in active_rooms.get(room_id, {}).get("clients", set()):
            active_rooms[room_id]["clients"].remove(websocket)
            if not active_rooms[room_id]["clients"]:
                del active_rooms[room_id]
    except Exception as e:
        for ws_client in list(active_rooms.get(room_id, {}).get("clients", [])):
            try:
                await ws_client.send_text(f"❌ **AI Error:** {str(e)}")
                await ws_client.send_text("[END]")
            except:
                pass


@app.get("/")
def root():
    return {"status": "Python Brain is alive 🧠"}