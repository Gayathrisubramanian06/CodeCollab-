'use client'

import { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { createSyncEngine } from '@/app/lib/syncEngine'
import { MonacoBinding } from 'y-monaco'
import { debounce } from '@/app/lib/debounce'

interface Message {
    id: number
    type: 'user' | 'ai' | 'status'
    text: string
    streaming?: boolean
}

// ── Debounced autocomplete fetcher ────────────────────────────────────────────
// Defined outside the component so it is created once and persists across renders.
const debouncedFetch = debounce(
    async (
        code: string,
        language: string,
        resolve: (val: string) => void
    ) => {
        try {
            const res = await fetch('http://localhost:8000/autocomplete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, language }),
            })
            const { completion } = await res.json()
            resolve(completion || '')
        } catch {
            resolve('')
        }
    },
    400   // ms — fires only after user pauses typing for 400 ms
)

export default function EditorLayout({ roomId }: { roomId: string }) {
    const editorRef = useRef<any>(null)
    const wsRef = useRef<WebSocket | null>(null)
    const [isPanelOpen, setIsPanelOpen] = useState(false)
    const [messages, setMessages] = useState<Message[]>([])
    const [isAnalyzing, setIsAnalyzing] = useState(false)
    const [selectionOnly, setSelectionOnly] = useState(false)
    const [chatInput, setChatInput] = useState('')
    const [ghostTextEnabled, setGhostTextEnabled] = useState(true)
    const bottomRef = useRef<HTMLDivElement>(null)

    // Auto scroll to latest message
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    // ── WebSocket connection for AI review panel ──────────────────────────────
    useEffect(() => {
        const ws = new WebSocket('ws://localhost:8000/ws/chat')

        ws.onopen = () => console.log('✅ Connected to AI backend')

        ws.onmessage = (e) => {
            const token = e.data

            if (token === '__END__') {
                setIsAnalyzing(false)
                setMessages((prev) => {
                    const last = prev[prev.length - 1]
                    if (last && last.streaming) {
                        return [...prev.slice(0, -1), { ...last, streaming: false }]
                    }
                    return prev
                })
                return
            }

            setMessages((prev) => {
                const last = prev[prev.length - 1]

                if (last && last.type === 'ai' && last.streaming) {
                    return [
                        ...prev.slice(0, -1),
                        { ...last, text: last.text + token }
                    ]
                }

                return [
                    ...prev,
                    { id: Date.now(), type: 'ai', text: token, streaming: true }
                ]
            })
        }

        ws.onerror = () => console.error('WebSocket error')
        wsRef.current = ws

        return () => ws.close()
    }, [])

    // ── Editor mount: Yjs binding + Ghost Text provider ───────────────────────
    function handleEditorMount(editor: any, monacoInstance: any) {
        editorRef.current = editor

        // Yjs real-time collab (unchanged)
        const { sharedText, awareness } = createSyncEngine(roomId)
        new MonacoBinding(sharedText, editor.getModel(), new Set([editor]), awareness)

        // ── Inline Completions Provider (Copilot-style ghost text) ────────────
        monacoInstance.languages.registerInlineCompletionsProvider(
            { pattern: '**' },   // applies to all languages
            {
                async provideInlineCompletions(model: any, position: any) {
                    // Read ghostTextEnabled from a ref so the closure stays fresh
                    if (!ghostEnabledRef.current) return { items: [] }

                    // Grab the last ~20 lines up to cursor position as context
                    const lineNumber = position.lineNumber
                    const startLine = Math.max(1, lineNumber - 20)

                    const codeContext = model.getValueInRange({
                        startLineNumber: startLine,
                        startColumn: 1,
                        endLineNumber: lineNumber,
                        endColumn: position.column,
                    })

                    // Skip if context is too short to be meaningful
                    if (codeContext.trim().length < 5) return { items: [] }

                    // Wait for debounced response
                    const completion = await new Promise<string>((resolve) => {
                        debouncedFetch(codeContext, model.getLanguageId(), resolve)
                    })

                    if (!completion) return { items: [] }

                    return {
                        items: [
                            {
                                insertText: completion,
                                range: {
                                    startLineNumber: position.lineNumber,
                                    startColumn: position.column,
                                    endLineNumber: position.lineNumber,
                                    endColumn: position.column,
                                },
                            },
                        ],
                    }
                },

                freeInlineCompletions() {
                    // nothing to free
                },
            }
        )

        // Enable inline suggestions in Monaco editor options
        editor.updateOptions({
            inlineSuggest: { enabled: true },
        })
    }

    // Ref mirror of ghostTextEnabled so the provider closure always reads
    // the latest value without needing to re-register the provider.
    const ghostEnabledRef = useRef(ghostTextEnabled)
    useEffect(() => {
        ghostEnabledRef.current = ghostTextEnabled
    }, [ghostTextEnabled])

    // ── Analyze Code button ───────────────────────────────────────────────────
    function analyzeCode() {
        const editor = editorRef.current
        if (!editor || !wsRef.current) return

        let code: string

        if (selectionOnly) {
            const selection = editor.getSelection()
            const hasHighlight = selection && !selection.isEmpty()
            code = hasHighlight
                ? editor.getModel().getValueInRange(selection)
                : editor.getValue()
        } else {
            code = editor.getValue()
        }

        if (!code) return

        setIsPanelOpen(true)
        setIsAnalyzing(true)
        setMessages((prev) => [
            ...prev,
            { id: Date.now(), type: 'user', text: code },
        ])
        wsRef.current.send(code)
    }

    // ── Chat input ────────────────────────────────────────────────────────────
    function handleSendChat() {
        const message = chatInput.trim()
        if (!message || !wsRef.current) return

        setMessages((prev) => [
            ...prev,
            { id: Date.now(), type: 'user', text: message },
        ])

        setIsAnalyzing(true)
        setIsPanelOpen(true)
        wsRef.current.send(message)
        setChatInput('')
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSendChat()
        }
    }

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="editor-root">

            {/* Top Bar */}
            <div className="top-bar">
                <span className="room-tag">Room: {roomId}</span>

                {/* Ghost text toggle */}
                <button
                    className={`ghost-toggle-btn ${ghostTextEnabled ? 'active' : 'inactive'}`}
                    onClick={() => setGhostTextEnabled((v) => !v)}
                    title="Toggle Copilot-style ghost text autocomplete"
                >
                    {ghostTextEnabled ? '✨ Ghost Text On' : '✨ Ghost Text Off'}
                </button>

                <label className="selection-toggle" title="Highlight code in the editor, then analyze only that part">
                    <input
                        type="checkbox"
                        checked={selectionOnly}
                        onChange={(e) => setSelectionOnly(e.target.checked)}
                    />
                    {selectionOnly ? '✂️ Selection' : '📄 Full File'}
                </label>

                <button
                    className={`analyze-btn ${isAnalyzing ? 'loading' : ''}`}
                    onClick={analyzeCode}
                    disabled={isAnalyzing}
                >
                    {isAnalyzing ? '🤖 Analyzing...' : '⚡ Analyze Code'}
                </button>

                <button
                    className="toggle-panel-btn"
                    onClick={() => setIsPanelOpen(!isPanelOpen)}
                >
                    {isPanelOpen ? 'Hide Panel ✕' : 'Show Panel →'}
                </button>
            </div>

            {/* Editor + Panel side by side */}
            <div className="editor-wrapper">

                {/* Monaco Editor */}
                <div className={`editor-area ${isPanelOpen ? 'shrink' : ''}`}>
                    <Editor
                        height="100%"
                        defaultLanguage="javascript"
                        theme="vs-dark"
                        onMount={handleEditorMount}
                        options={{
                            fontSize: 14,
                            minimap: { enabled: false },
                            padding: { top: 16 },
                            // These three options together enable ghost text
                            inlineSuggest: { enabled: true },
                            quickSuggestions: false,   // prevents the dropdown competing
                            suggest: { preview: true },
                        }}
                    />
                </div>

                {/* AI Side Panel */}
                <div className={`ai-panel ${isPanelOpen ? 'open' : ''}`}>
                    <div className="ai-panel-header">
                        <span className="ai-dot" />
                        <h2>AI Review</h2>
                    </div>

                    {/* Messages */}
                    <div className="ai-messages">
                        {messages.length === 0 && (
                            <div className="ai-empty">
                                Press <strong>Analyze Code</strong> to review your code ✨
                            </div>
                        )}

                        {messages.map((msg) => (
                            <div key={msg.id} className={`ai-message ${msg.type}`}>
                                <span className="ai-label">
                                    {msg.type === 'ai' ? '🤖 AI Review' : '📝 You'}
                                </span>
                                <p>
                                    {msg.text}
                                    {msg.streaming && (
                                        <span className="stream-cursor">▋</span>
                                    )}
                                </p>
                            </div>
                        ))}

                        {/* Spinner only while waiting for first token */}
                        {isAnalyzing && !messages.some(m => m.streaming) && (
                            <div className="ai-message ai">
                                <span className="ai-label">🤖 AI Review</span>
                                <p className="typing">Thinking<span>...</span></p>
                            </div>
                        )}

                        <div ref={bottomRef} />
                    </div>

                    {/* Chat input */}
                    <div className="chat-input-area">
                        <textarea
                            className="chat-input"
                            placeholder="Ask the AI anything... (Enter to send)"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            rows={2}
                        />
                        <button
                            className="chat-send-btn"
                            onClick={handleSendChat}
                            disabled={isAnalyzing || !chatInput.trim()}
                        >
                            Send
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}