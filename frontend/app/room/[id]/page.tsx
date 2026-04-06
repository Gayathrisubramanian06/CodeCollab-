
'use client';

import { use, useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';

interface Message {
    id: number;
    type: 'user' | 'ai' | 'status';
    text: string;
}

export default function Room({ params }: { params: Promise<{ id: string }> }) {

    const { id: roomId } = use(params);
    const editorRef = useRef<any>(null);

    const [isConnected, setIsConnected] = useState(false);
    const [isAiConnected, setIsAiConnected] = useState(false);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const providerRef = useRef<any>(null);
    const bindingRef = useRef<any>(null);
    const ydocRef = useRef<any>(null);
    const aiSocketRef = useRef<WebSocket | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);

    // Auto scroll to latest message
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleEditorDidMount = async (editor: any, monaco: any) => {
        editorRef.current = editor;

        const Y = await import('yjs');
        const { WebrtcProvider } = await import('y-webrtc');
        const { MonacoBinding } = await import('y-monaco');

        const ydoc = new Y.Doc();
        ydocRef.current = ydoc;

        const provider = new WebrtcProvider(roomId, ydoc);
        providerRef.current = provider;

        const ytext = ydoc.getText('monaco');

        const binding = new MonacoBinding(
            ytext,
            editorRef.current.getModel(),
            new Set([editorRef.current]),
            provider.awareness
        );
        bindingRef.current = binding;
        setIsConnected(true);
    };

    // Connect to Python AI backend
    useEffect(() => {
        const ws = new WebSocket('ws://127.0.0.1:8000/ws/chat');

        ws.onopen = () => setIsAiConnected(true);

        ws.onmessage = (event) => {
            const text: string = event.data;

            // ── Handle CLEAR confirmation from backend ──────────────────
            if (text.startsWith('🗑️')) {
                setIsAnalyzing(false);
                setMessages([{
                    id: Date.now(),
                    type: 'status',
                    text,
                }]);
                return;
            }

            // ── Hide "Reviewing..." status before showing real response ──
            setMessages((prev) => {
                const withoutReviewing = prev.filter(
                    (m) => !(m.type === 'status' && m.text.startsWith('⚙️'))
                );
                return [
                    ...withoutReviewing,
                    { id: Date.now(), type: 'ai', text },
                ];
            });
            setIsAnalyzing(false);
        };

        ws.onclose = () => setIsAiConnected(false);
        aiSocketRef.current = ws;

        return () => ws.close();
    }, []);

    // Send code to AI
    const handleAskAI = () => {
        if (!aiSocketRef.current || !isAiConnected) {
            setMessages((prev) => [
                ...prev,
                { id: Date.now(), type: 'status', text: '❌ AI Brain is offline! Tell Developer B to start the Python server.' },
            ]);
            setIsPanelOpen(true);
            return;
        }

        const currentCode = editorRef.current?.getValue();
        if (!currentCode?.trim()) {
            setMessages((prev) => [
                ...prev,
                { id: Date.now(), type: 'status', text: '⚠️ Editor is empty. Write some code first!' },
            ]);
            setIsPanelOpen(true);
            return;
        }

        setIsPanelOpen(true);
        setIsAnalyzing(true);
        setMessages((prev) => [
            ...prev,
            { id: Date.now(), type: 'user', text: currentCode },
        ]);

        aiSocketRef.current.send(currentCode);
    };

    // ── Clear chat: wipe frontend state AND tell backend to clear history ──
    const handleClearChat = () => {
        // 1. Clear frontend messages immediately
        setMessages([]);
        setIsAnalyzing(false);

        // 2. Tell backend to clear its conversation_history for this socket
        if (aiSocketRef.current && isAiConnected) {
            aiSocketRef.current.send('CLEAR');
        }
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (bindingRef.current) bindingRef.current.destroy();
            if (providerRef.current) providerRef.current.destroy();
            if (ydocRef.current) ydocRef.current.destroy();
        };
    }, []);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%', background: '#0d0d0d', fontFamily: 'monospace' }}>

            {/* ── Top Bar ── */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#0d1117', padding: '10px 20px',
                borderBottom: '1px solid #1e1e1e'
            }}>

                {/* Logo */}
                <div style={{
                    fontSize: '18px', fontWeight: 'bold',
                    background: 'linear-gradient(to right, #60a5fa, #a855f7)',
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
                }}>
                    CodeCollab
                </div>

                {/* Status Indicators */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px', fontSize: '13px' }}>
                    {/* Multiplayer */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                            width: '8px', height: '8px', borderRadius: '50%',
                            background: isConnected ? '#22c55e' : '#eab308'
                        }} />
                        <span style={{ color: '#888' }}>
                            {isConnected ? <>Live: <span style={{ color: '#fff' }}>{roomId}</span></> : 'Connecting...'}
                        </span>
                    </div>

                    {/* AI Status */}
                    <div style={{
                        padding: '4px 10px', borderRadius: '6px', fontSize: '12px',
                        color: isAiConnected ? '#4ade80' : '#f87171',
                        border: `1px solid ${isAiConnected ? '#166534' : '#7f1d1d'}`,
                        background: isAiConnected ? '#052e16' : '#2d0000'
                    }}>
                        {isAiConnected ? '🟢 AI Online' : '🔴 AI Offline'}
                    </div>
                </div>

                {/* Buttons */}
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        onClick={handleAskAI}
                        disabled={isAnalyzing}
                        style={{
                            background: isAnalyzing ? '#3b1f6e' : '#7c3aed',
                            color: isAnalyzing ? '#888' : '#fff',
                            border: 'none', padding: '8px 18px',
                            borderRadius: '8px', fontSize: '13px',
                            fontWeight: 'bold', cursor: isAnalyzing ? 'not-allowed' : 'pointer',
                            transition: 'all 0.2s',
                            boxShadow: '0 0 12px rgba(124,58,237,0.3)'
                        }}
                    >
                        {isAnalyzing ? '🤖 Analyzing...' : '✨ Ask AI'}
                    </button>

                    {/* Toggle Panel Button */}
                    <button
                        onClick={() => setIsPanelOpen(!isPanelOpen)}
                        style={{
                            background: '#1a1a1a', color: '#888',
                            border: '1px solid #333', padding: '8px 16px',
                            borderRadius: '8px', fontSize: '12px', cursor: 'pointer'
                        }}
                    >
                        {isPanelOpen ? 'Hide Panel ✕' : 'Show Panel →'}
                    </button>

                    <button style={{
                        background: '#fff', color: '#000',
                        border: 'none', padding: '8px 18px',
                        borderRadius: '8px', fontSize: '13px',
                        fontWeight: 'bold', cursor: 'pointer'
                    }}>
                        Share Link
                    </button>
                </div>
            </div>

            {/* ── Editor + AI Panel ── */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

                {/* Monaco Editor */}
                <div style={{
                    flex: isPanelOpen ? '0.55' : '1',
                    transition: 'flex 0.3s ease',
                    overflow: 'hidden'
                }}>
                    <Editor
                        height="100%"
                        theme="vs-dark"
                        defaultLanguage="javascript"
                        onMount={handleEditorDidMount}
                        options={{
                            minimap: { enabled: false },
                            fontSize: 16,
                            padding: { top: 20 }
                        }}
                    />
                </div>

                {/* ── AI Side Panel ── */}
                <div style={{
                    width: isPanelOpen ? '420px' : '0px',
                    minWidth: isPanelOpen ? '380px' : '0px',
                    overflow: 'hidden',
                    background: '#111',
                    borderLeft: '1px solid #1e1e1e',
                    transition: 'width 0.3s ease, min-width 0.3s ease',
                    display: 'flex',
                    flexDirection: 'column',
                }}>

                    {/* Panel Header */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '10px',
                        padding: '16px 20px', borderBottom: '1px solid #1e1e1e',
                        flexShrink: 0
                    }}>
                        <div style={{
                            width: '8px', height: '8px', borderRadius: '50%',
                            background: '#00ff88', boxShadow: '0 0 8px #00ff88'
                        }} />
                        <span style={{ color: '#eee', fontSize: '14px', fontWeight: 600 }}>
                            AI Review
                        </span>

                        {/* ── CLEAR CHAT BUTTON ── */}
                        {messages.length > 0 && (
                            <button
                                onClick={handleClearChat}
                                title="Clear chat and reset AI memory"
                                style={{
                                    marginLeft: 'auto',
                                    background: 'none',
                                    border: '1px solid #333',
                                    color: '#555',
                                    fontSize: '11px',
                                    padding: '3px 10px',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontFamily: 'monospace',
                                    transition: 'border-color 0.15s, color 0.15s',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '5px',
                                }}
                                onMouseEnter={e => {
                                    (e.currentTarget as HTMLButtonElement).style.borderColor = '#f87171';
                                    (e.currentTarget as HTMLButtonElement).style.color = '#f87171';
                                }}
                                onMouseLeave={e => {
                                    (e.currentTarget as HTMLButtonElement).style.borderColor = '#333';
                                    (e.currentTarget as HTMLButtonElement).style.color = '#555';
                                }}
                            >
                                🗑️ Clear
                            </button>
                        )}
                    </div>

                    {/* Messages */}
                    <div style={{
                        flex: 1, overflowY: 'auto',
                        padding: '16px', display: 'flex',
                        flexDirection: 'column', gap: '16px'
                    }}>

                        {/* Empty state */}
                        {messages.length === 0 && (
                            <div style={{
                                color: '#444', fontSize: '13px',
                                textAlign: 'center', marginTop: '40px', lineHeight: '1.8'
                            }}>
                                Press <strong style={{ color: '#7c3aed' }}>✨ Ask AI</strong> to review your code
                            </div>
                        )}

                        {/* Message bubbles */}
                        {messages.map((msg) => (
                            <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>

                                {/* Label */}
                                <span style={{
                                    fontSize: '11px', color: '#555',
                                    fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px'
                                }}>
                                    {msg.type === 'ai' ? '🤖 AI Review' : msg.type === 'user' ? '📝 Code Sent' : '⚙️ Status'}
                                </span>

                                {/* Bubble */}
                                <div style={{
                                    background: msg.type === 'ai' ? '#1a1a1a' : msg.type === 'user' ? '#0a0a0a' : '#1a1208',
                                    color: msg.type === 'ai' ? '#ddd' : msg.type === 'user' ? '#555' : '#f59e0b',
                                    padding: '12px 16px',
                                    borderRadius: '8px',
                                    fontSize: msg.type === 'user' ? '11px' : '13px',
                                    lineHeight: '1.7',
                                    borderLeft: `3px solid ${msg.type === 'ai' ? '#00ff88' : msg.type === 'user' ? '#333' : '#f59e0b'}`,
                                    whiteSpace: 'pre-wrap',
                                    maxHeight: msg.type === 'user' ? '80px' : 'none',
                                    overflow: msg.type === 'user' ? 'hidden' : 'visible',
                                }}>
                                    {msg.text}
                                </div>
                            </div>
                        ))}

                        {/* Typing indicator */}
                        {isAnalyzing && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <span style={{ fontSize: '11px', color: '#555', fontWeight: 600, textTransform: 'uppercase' }}>
                                    🤖 AI Review
                                </span>
                                <div style={{
                                    background: '#1a1a1a', color: '#00ff88',
                                    padding: '12px 16px', borderRadius: '8px',
                                    fontSize: '13px', borderLeft: '3px solid #00ff88'
                                }}>
                                    Thinking...
                                </div>
                            </div>
                        )}

                        <div ref={bottomRef} />
                    </div>
                </div>
            </div>
        </div>
    );
}