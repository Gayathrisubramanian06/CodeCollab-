'use client'

import { useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { createSyncEngine } from '@/app/lib/syncEngine'
import { MonacoBinding } from 'y-monaco'

interface Message {
    id: number
    type: 'user' | 'ai' | 'status'
    text: string
}

export default function EditorLayout({ roomId }: { roomId: string }) {
    const editorRef = useRef<any>(null)
    const wsRef = useRef<WebSocket | null>(null)
    const [isPanelOpen, setIsPanelOpen] = useState(false)
    const [messages, setMessages] = useState<Message[]>([])
    const [isAnalyzing, setIsAnalyzing] = useState(false)
    const [selectionOnly, setSelectionOnly] = useState(false)  // 👈 NEW
    const bottomRef = useRef<HTMLDivElement>(null)

    // Auto scroll to latest message
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    // Connect to Python backend WebSocket
    useEffect(() => {
        const ws = new WebSocket('ws://localhost:8000/ws/analyze')

        ws.onopen = () => console.log('✅ Connected to AI backend')

        ws.onmessage = (e) => {
            setIsAnalyzing(false)
            setMessages((prev) => [
                ...prev,
                { id: Date.now(), type: 'ai', text: e.data },
            ])
        }

        ws.onerror = () => console.error('WebSocket error')
        wsRef.current = ws

        return () => ws.close()
    }, [])

    // Mount Monaco + Yjs
    function handleEditorMount(editor: any) {
        editorRef.current = editor
        const { sharedText, awareness } = createSyncEngine(roomId)
        new MonacoBinding(sharedText, editor.getModel(), new Set([editor]), awareness)
    }

    // Send code to AI — supports full file OR selected text
    function analyzeCode() {
        const editor = editorRef.current
        if (!editor || !wsRef.current) return

        let code: string

        if (selectionOnly) {
            // getSelection() returns the current highlighted range in the editor
            const selection = editor.getSelection()

            // isEmpty() is true when cursor is placed but nothing is highlighted
            const hasHighlight = selection && !selection.isEmpty()

            // If something is highlighted, grab just that. Otherwise fall back to full file.
            code = hasHighlight
                ? editor.getModel().getValueInRange(selection)
                : editor.getValue()
        } else {
            // Default: send the entire file
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

    return (
        <div className="editor-root">

            {/* Top Bar */}
            <div className="top-bar">
                <span className="room-tag">Room: {roomId}</span>

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
                        }}
                    />
                </div>

                {/* AI Side Panel */}
                <div className={`ai-panel ${isPanelOpen ? 'open' : ''}`}>
                    <div className="ai-panel-header">
                        <span className="ai-dot" />
                        <h2>AI Review</h2>
                    </div>

                    <div className="ai-messages">
                        {messages.length === 0 && (
                            <div className="ai-empty">
                                Press <strong>Analyze Code</strong> to review your code ✨
                            </div>
                        )}

                        {messages.map((msg) => (
                            <div key={msg.id} className={`ai-message ${msg.type}`}>
                                <span className="ai-label">
                                    {msg.type === 'ai' ? '🤖 AI Review' : '📝 Code Sent'}
                                </span>
                                <p>{msg.text}</p>
                            </div>
                        ))}

                        {isAnalyzing && (
                            <div className="ai-message ai">
                                <span className="ai-label">🤖 AI Review</span>
                                <p className="typing">Thinking<span>...</span></p>
                            </div>
                        )}

                        <div ref={bottomRef} />
                    </div>
                </div>

            </div>
        </div>
    )
}