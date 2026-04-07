'use client';

import { use, useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { debounce } from '@/app/lib/debounce';

// ── Debounced autocomplete fetcher ────────────────────────────────────────────
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
    400
)

interface Message {
    id: number;
    type: 'user' | 'ai' | 'status';
    text: string;
}

interface DiffPayload {
    original: string;
    modified: string;
}

const extractText = (node: any): string => {
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(extractText).join('');
    if (node && node.props && node.props.children) return extractText(node.props.children);
    return '';
};

export default function Room({ params }: { params: Promise<{ id: string }> }) {

    const { id: roomId } = use(params);
    const editorRef = useRef<any>(null);
    const monacoRef = useRef<any>(null);
    const diffEditorRef = useRef<any>(null);
    const diffContainerRef = useRef<HTMLDivElement>(null);

    const [isConnected, setIsConnected] = useState(false);
    const [isAiConnected, setIsAiConnected] = useState(false);
    const [isPanelOpen, setIsPanelOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [selectionOnly, setSelectionOnly] = useState(false);
    const [chatInput, setChatInput] = useState('');
    const [ghostTextEnabled, setGhostTextEnabled] = useState(true);
    const [language, setLanguage] = useState('javascript');
    const [terminalOutput, setTerminalOutput] = useState('');
    const [isExecuting, setIsExecuting] = useState(false);
    const [terminalError, setTerminalError] = useState(false);
    const [diffPayload, setDiffPayload] = useState<DiffPayload | null>(null);

    const providerRef = useRef<any>(null);
    const bindingRef = useRef<any>(null);
    const ydocRef = useRef<any>(null);
    const aiSocketRef = useRef<WebSocket | null>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const ghostEnabledRef = useRef(ghostTextEnabled);

    useEffect(() => { ghostEnabledRef.current = ghostTextEnabled; }, [ghostTextEnabled]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // ── Build Monaco Diff Editor whenever diffPayload changes ─────────────────
    useEffect(() => {
        if (!diffPayload || !diffContainerRef.current || !monacoRef.current) return;

        if (diffEditorRef.current) {
            diffEditorRef.current.dispose();
            diffEditorRef.current = null;
        }

        const monaco = monacoRef.current;
        const container = diffContainerRef.current;

        const de = monaco.editor.createDiffEditor(container, {
            theme: 'vs-dark',
            renderSideBySide: true,
            readOnly: true,
            fontSize: 13,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            padding: { top: 12 },
        });

        de.setModel({
            original: monaco.editor.createModel(diffPayload.original, language),
            modified: monaco.editor.createModel(diffPayload.modified, language),
        });

        diffEditorRef.current = de;

        return () => {
            de.dispose();
            diffEditorRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [diffPayload]);

    // ── Accept diff ───────────────────────────────────────────────────────────
    const handleAcceptDiff = () => {
        if (!diffPayload || !editorRef.current) return;
        const editor = editorRef.current;
        const sel = editor.getSelection();
        if (sel && !sel.isEmpty()) {
            editor.executeEdits('ai-apply', [{ range: sel, text: diffPayload.modified, forceMoveMarkers: true }]);
        } else {
            editor.executeEdits('ai-apply', [{ range: editor.getModel().getFullModelRange(), text: diffPayload.modified, forceMoveMarkers: true }]);
        }
        setDiffPayload(null);
    };

    // ── Editor mount ──────────────────────────────────────────────────────────
    const handleEditorDidMount = async (editor: any, monaco: any) => {
        editorRef.current = editor;
        monacoRef.current = monaco;

        const Y = await import('yjs');
        const { WebrtcProvider } = await import('y-webrtc');
        const { MonacoBinding } = await import('y-monaco');

        const ydoc = new Y.Doc();
        ydocRef.current = ydoc;

        const provider = new WebrtcProvider(roomId, ydoc);
        providerRef.current = provider;

        const ytext = ydoc.getText('monaco');
        const binding = new MonacoBinding(ytext, editor.getModel(), new Set([editor]), provider.awareness);
        bindingRef.current = binding;
        setIsConnected(true);

        monaco.languages.registerInlineCompletionsProvider({ pattern: '**' }, {
            async provideInlineCompletions(model: any, position: any) {
                if (!ghostEnabledRef.current) return { items: [] };
                const lineNumber = position.lineNumber;
                const startLine = Math.max(1, lineNumber - 20);
                const codeContext = model.getValueInRange({
                    startLineNumber: startLine, startColumn: 1,
                    endLineNumber: lineNumber, endColumn: position.column,
                });
                if (codeContext.trim().length < 5) return { items: [] };
                const completion = await new Promise<string>((resolve) => {
                    debouncedFetch(codeContext, model.getLanguageId(), resolve);
                });
                if (!completion) return { items: [] };
                return {
                    items: [{
                        insertText: completion, range: {
                            startLineNumber: position.lineNumber, startColumn: position.column,
                            endLineNumber: position.lineNumber, endColumn: position.column,
                        }
                    }]
                };
            },
            freeInlineCompletions() { },
        });

        editor.updateOptions({ inlineSuggest: { enabled: true } });
    };

    // ── WebSocket to AI backend ───────────────────────────────────────────────
    useEffect(() => {
        if (!roomId) return;
        const ws = new WebSocket(`ws://127.0.0.1:8000/ws/chat/${roomId}`);
        ws.onopen = () => setIsAiConnected(true);
        ws.onclose = () => setIsAiConnected(false);
        ws.onmessage = (event) => {
            const data: string = event.data;
            if (data === '[START]') {
                setIsAnalyzing(false);
                setMessages(prev => {
                    const filtered = prev.filter(m => !(m.type === 'status' && m.text.startsWith('⚙️')));
                    return [...filtered, { id: Date.now() + Math.random(), type: 'ai', text: '' }];
                });
            } else if (data === '[END]') {
                // nothing to do
            } else if (data.startsWith('⚙️') || data.startsWith('🗑️') || data.startsWith('❌')) {
                setMessages(prev => [...prev, { id: Date.now() + Math.random(), type: 'status', text: data }]);
                setIsAnalyzing(false);
            } else {
                setMessages(prev => {
                    const arr = [...prev];
                    const lastMsg = arr[arr.length - 1];
                    if (lastMsg && lastMsg.type === 'ai') {
                        arr[arr.length - 1] = { ...lastMsg, text: lastMsg.text + data };
                    }
                    return arr;
                });
            }
        };
        aiSocketRef.current = ws;
        return () => ws.close();
    }, [roomId]);

    // ── Run Code ──────────────────────────────────────────────────────────────
    const handleRunCode = async () => {
        const editor = editorRef.current;
        if (!editor || !roomId) return;
        let currentCode: string;
        if (selectionOnly) {
            const sel = editor.getSelection();
            currentCode = (!sel || sel.isEmpty()) ? editor.getValue() : editor.getModel().getValueInRange(sel);
        } else {
            currentCode = editor.getValue();
        }
        if (!currentCode.trim()) return;
        setIsExecuting(true);
        setTerminalOutput('Executing Locally...');
        setTerminalError(false);
        try {
            const res = await fetch('http://localhost:8000/execute', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: currentCode, language, room_id: roomId }),
            });
            const data = await res.json();
            setTerminalOutput(data.output || 'Execution completed with no output.');
            if (data.error) { setTerminalError(true); setIsPanelOpen(true); }
        } catch (e: any) {
            setTerminalOutput(`Network Error: ${e.message}`);
            setTerminalError(true);
        } finally {
            setIsExecuting(false);
        }
    };

    // ── Ask AI ────────────────────────────────────────────────────────────────
    const handleAskAI = () => {
        if (!aiSocketRef.current || !isAiConnected) {
            setMessages(prev => [...prev, { id: Date.now() + Math.random(), type: 'status', text: '❌ AI Brain is offline!' }]);
            setIsPanelOpen(true);
            return;
        }
        const editor = editorRef.current;
        if (!editor) return;
        let currentCode: string;
        if (selectionOnly) {
            const sel = editor.getSelection();
            currentCode = (sel && !sel.isEmpty()) ? editor.getModel().getValueInRange(sel) : editor.getValue();
        } else {
            currentCode = editor.getValue();
        }
        if (!currentCode?.trim()) {
            setMessages(prev => [...prev, { id: Date.now() + Math.random(), type: 'status', text: '⚠️ Editor is empty. Write some code first!' }]);
            setIsPanelOpen(true);
            return;
        }
        setIsPanelOpen(true);
        setIsAnalyzing(true);
        setMessages(prev => [...prev, { id: Date.now() + Math.random(), type: 'user', text: currentCode }]);
        aiSocketRef.current.send(currentCode);
    };

    // ── Chat send ─────────────────────────────────────────────────────────────
    const handleSendChat = () => {
        const message = chatInput.trim();
        if (!message || !aiSocketRef.current || !isAiConnected) return;
        setMessages(prev => [...prev, { id: Date.now() + Math.random(), type: 'user', text: message }]);
        setIsAnalyzing(true);
        setIsPanelOpen(true);
        aiSocketRef.current.send(message);
        setChatInput('');
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat(); }
    };

    // ── Clear chat ────────────────────────────────────────────────────────────
    const handleClearChat = () => {
        setMessages([]);
        setIsAnalyzing(false);
        if (aiSocketRef.current && isAiConnected) aiSocketRef.current.send('CLEAR');
    };

    // ── Stage diff (replaces instant apply) ───────────────────────────────────
    const handleStageDiff = (aiCode: string) => {
        const editor = editorRef.current;
        if (!editor) return;
        setDiffPayload({ original: editor.getValue(), modified: aiCode });
    };

    // ── Share link ────────────────────────────────────────────────────────────
    const handleShareLink = () => {
        navigator.clipboard.writeText(window.location.href);
    };

    // ── Cleanup ───────────────────────────────────────────────────────────────
    useEffect(() => {
        return () => {
            bindingRef.current?.destroy();
            providerRef.current?.destroy();
            ydocRef.current?.destroy();
        };
    }, []);

    // ─────────────────────────────────────────────────────────────────────────
    // RENDER
    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%', background: '#0d0d0d', fontFamily: 'monospace', overflow: 'hidden' }}>

            {/* ── Top Bar ── */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: '#0d1117', padding: '10px 20px',
                borderBottom: '1px solid #1e1e1e', flexShrink: 0,
            }}>
                <div style={{
                    fontSize: '18px', fontWeight: 'bold',
                    background: 'linear-gradient(to right, #60a5fa, #a855f7)',
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                }}>
                    CodeCollab
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '20px', fontSize: '13px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: isConnected ? '#22c55e' : '#eab308' }} />
                        <span style={{ color: '#888' }}>
                            {isConnected ? <>Live: <span style={{ color: '#fff' }}>{roomId}</span></> : 'Connecting...'}
                        </span>
                    </div>
                    <div style={{
                        padding: '4px 10px', borderRadius: '6px', fontSize: '12px',
                        color: isAiConnected ? '#4ade80' : '#f87171',
                        border: `1px solid ${isAiConnected ? '#166534' : '#7f1d1d'}`,
                        background: isAiConnected ? '#052e16' : '#2d0000',
                    }}>
                        {isAiConnected ? '🟢 AI Online' : '🔴 AI Offline'}
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <select
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        style={{ background: '#1a1a1a', color: '#eee', border: '1px solid #333', padding: '6px 8px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', outline: 'none' }}
                    >
                        <option value="javascript">JS / TS</option>
                        <option value="python">Python</option>
                        <option value="html">HTML</option>
                        <option value="css">CSS</option>
                        <option value="java">Java</option>
                        <option value="cpp">C++</option>
                    </select>

                    <button
                        onClick={() => setGhostTextEnabled(v => !v)}
                        style={{
                            background: ghostTextEnabled ? '#1f3a2a' : '#1a1a1a',
                            color: ghostTextEnabled ? '#3fb950' : '#888',
                            border: `1px solid ${ghostTextEnabled ? '#3fb950' : '#333'}`,
                            padding: '6px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
                        }}
                    >
                        {ghostTextEnabled ? '✨ Ghost Text On' : '✨ Ghost Text Off'}
                    </button>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#ccc', fontSize: '13px', cursor: 'pointer', userSelect: 'none' }}>
                        <input
                            type="checkbox" checked={selectionOnly}
                            onChange={(e) => setSelectionOnly(e.target.checked)}
                            style={{ accentColor: '#7c3aed', width: '14px', height: '14px', cursor: 'pointer' }}
                        />
                        Selection Only
                    </label>

                    <button
                        onClick={handleRunCode} disabled={isExecuting}
                        style={{
                            background: isExecuting ? '#444' : '#22c55e', color: '#fff', border: 'none',
                            padding: '8px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold',
                            cursor: isExecuting ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
                            boxShadow: '0 0 12px rgba(34,197,94,0.3)',
                        }}
                    >
                        {isExecuting ? '⏳ Running...' : '▶ Run Code'}
                    </button>

                    <button
                        onClick={handleAskAI} disabled={isAnalyzing}
                        style={{
                            background: isAnalyzing ? '#3b1f6e' : '#7c3aed',
                            color: isAnalyzing ? '#888' : '#fff', border: 'none',
                            padding: '8px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold',
                            cursor: isAnalyzing ? 'not-allowed' : 'pointer', transition: 'all 0.2s',
                            boxShadow: '0 0 12px rgba(124,58,237,0.3)',
                        }}
                    >
                        {isAnalyzing ? '🤖 Analyzing...' : '✨ Ask AI'}
                    </button>

                    <button
                        onClick={() => setIsPanelOpen(v => !v)}
                        style={{ background: '#1a1a1a', color: '#888', border: '1px solid #333', padding: '8px 16px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer' }}
                    >
                        {isPanelOpen ? 'Hide Panel ✕' : 'Show Panel →'}
                    </button>

                    <button
                        onClick={handleShareLink}
                        style={{ background: '#fff', color: '#000', border: 'none', padding: '8px 18px', borderRadius: '8px', fontSize: '13px', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                        Share Link
                    </button>
                </div>
            </div>

            {/* ── Main: Editor (left) + AI Panel (right) ── */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

                {/* ── LEFT: Editor + Terminal — always takes remaining space ── */}
                <div style={{
                    flex: isPanelOpen ? '1 1 50%' : '1 1 100%',
                    display: 'flex', flexDirection: 'column',
                    transition: 'flex 0.3s ease',
                    overflow: 'hidden', minWidth: 0,
                }}>
                    {/* Editor */}
                    <div style={{ flex: '1 1 70%', minHeight: 0 }}>
                        <Editor
                            height="100%"
                            theme="vs-dark"
                            language={language}
                            onMount={handleEditorDidMount}
                            options={{
                                minimap: { enabled: false },
                                fontSize: 16,
                                padding: { top: 20 },
                                inlineSuggest: { enabled: true },
                                quickSuggestions: false,
                                suggest: { preview: true },
                            }}
                        />
                    </div>

                    {/* Terminal */}
                    <div style={{ flex: '0 0 30%', background: '#0a0a0a', borderTop: '1px solid #333', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        <div style={{ background: '#111', padding: '6px 15px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                            <div style={{ width: '10px', height: '10px', background: '#ff5f56', borderRadius: '50%' }} />
                            <div style={{ width: '10px', height: '10px', background: '#ffbd2e', borderRadius: '50%' }} />
                            <div style={{ width: '10px', height: '10px', background: '#27c93f', borderRadius: '50%' }} />
                            <span style={{ marginLeft: '10px', color: '#888', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' }}>Terminal</span>
                        </div>
                        <div style={{ flex: 1, padding: '10px 15px', overflowY: 'auto', color: terminalError ? '#f87171' : '#a3dec9', whiteSpace: 'pre-wrap', fontSize: '13px' }}>
                            {terminalOutput || 'Ready.'}
                        </div>
                    </div>
                </div>

                {/* ── RIGHT: AI Panel — always rendered, slides in/out ── */}
                <div style={{
                    flex: isPanelOpen ? '1 1 50%' : '0 0 0px',
                    display: 'flex', flexDirection: 'column',
                    overflow: 'hidden',
                    background: '#111',
                    borderLeft: isPanelOpen ? '1px solid #1e1e1e' : 'none',
                    transition: 'flex 0.3s ease',
                    minWidth: 0,
                }}>

                    {/* Panel Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '16px 20px', borderBottom: '1px solid #1e1e1e', flexShrink: 0 }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#00ff88', boxShadow: '0 0 8px #00ff88' }} />
                        <span style={{ color: '#eee', fontSize: '14px', fontWeight: 600 }}>AI Review</span>
                        {messages.length > 0 && (
                            <button
                                onClick={handleClearChat}
                                style={{
                                    marginLeft: 'auto', background: 'none', border: '1px solid #333',
                                    color: '#555', fontSize: '11px', padding: '3px 10px',
                                    borderRadius: '4px', cursor: 'pointer', fontFamily: 'monospace',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = '#f87171'; e.currentTarget.style.color = '#f87171'; }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = '#333'; e.currentTarget.style.color = '#555'; }}
                            >
                                🗑️ Clear
                            </button>
                        )}
                    </div>

                    {/* Messages scroll area */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', minHeight: 0 }}>
                        {messages.length === 0 && (
                            <div style={{ color: '#444', fontSize: '13px', textAlign: 'center', marginTop: '40px', lineHeight: '1.8' }}>
                                Press <strong style={{ color: '#7c3aed' }}>✨ Ask AI</strong> to review your code
                            </div>
                        )}

                        {messages.map((msg) => (
                            <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <span style={{ fontSize: '11px', color: '#555', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                    {msg.type === 'ai' ? '🤖 AI Review' : msg.type === 'user' ? '📝 Code Sent' : '⚙️ Status'}
                                </span>
                                <div style={{
                                    background: msg.type === 'ai' ? '#1a1a1a' : msg.type === 'user' ? '#0a0a0a' : '#1a1208',
                                    color: msg.type === 'ai' ? '#ddd' : msg.type === 'user' ? '#555' : '#f59e0b',
                                    padding: '12px 16px', borderRadius: '8px',
                                    fontSize: msg.type === 'user' ? '11px' : '13px', lineHeight: '1.7',
                                    borderLeft: `3px solid ${msg.type === 'ai' ? '#00ff88' : msg.type === 'user' ? '#333' : '#f59e0b'}`,
                                    whiteSpace: msg.type === 'ai' ? 'normal' : 'pre-wrap',
                                    maxHeight: msg.type === 'user' ? '80px' : 'none',
                                    overflow: msg.type === 'user' ? 'hidden' : 'visible',
                                }}>
                                    {msg.type === 'ai' ? (
                                        <ReactMarkdown
                                            rehypePlugins={[rehypeHighlight]}
                                            components={{
                                                code(props: any) {
                                                    const { children, className, ...rest } = props;
                                                    const match = /language-(\w+)/.exec(className || '');
                                                    const isInline = !match && !className;

                                                    if (isInline) {
                                                        return (
                                                            <code style={{ background: '#333', padding: '2px 4px', borderRadius: '4px' }} className={className} {...rest}>
                                                                {children}
                                                            </code>
                                                        );
                                                    }

                                                    const codeString = extractText(children).replace(/\n$/, '');

                                                    return (
                                                        <div style={{ position: 'relative', marginTop: '10px', marginBottom: '10px' }}>
                                                            <div style={{
                                                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                                background: '#222', padding: '4px 10px',
                                                                borderTopLeftRadius: '6px', borderTopRightRadius: '6px',
                                                                fontSize: '11px', color: '#888',
                                                            }}>
                                                                <span>{match ? match[1] : 'code'}</span>
                                                                {/* 🔍 Review Changes — opens diff overlay instead of instant apply */}
                                                                <button
                                                                    onClick={() => handleStageDiff(codeString)}
                                                                    style={{
                                                                        background: '#7c3aed', color: '#fff', border: 'none',
                                                                        padding: '4px 10px', borderRadius: '4px', cursor: 'pointer',
                                                                        fontSize: '11px', fontWeight: 'bold',
                                                                    }}
                                                                    onMouseEnter={e => e.currentTarget.style.background = '#6d28d9'}
                                                                    onMouseLeave={e => e.currentTarget.style.background = '#7c3aed'}
                                                                >
                                                                    🔍 Review Changes
                                                                </button>
                                                            </div>
                                                            <pre style={{ margin: 0, padding: '12px', background: '#0d0d0d', borderBottomLeftRadius: '6px', borderBottomRightRadius: '6px', overflowX: 'auto' }}>
                                                                <code className={className} {...rest}>{children}</code>
                                                            </pre>
                                                        </div>
                                                    );
                                                }
                                            }}
                                        >
                                            {msg.text}
                                        </ReactMarkdown>
                                    ) : (
                                        msg.text
                                    )}
                                </div>
                            </div>
                        ))}

                        {isAnalyzing && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <span style={{ fontSize: '11px', color: '#555', fontWeight: 600, textTransform: 'uppercase' }}>🤖 AI Review</span>
                                <div style={{ background: '#1a1a1a', color: '#00ff88', padding: '12px 16px', borderRadius: '8px', fontSize: '13px', borderLeft: '3px solid #00ff88' }}>
                                    Thinking...
                                </div>
                            </div>
                        )}

                        <div ref={bottomRef} />
                    </div>

                    {/* ── Chat Input — always visible inside the panel ── */}
                    <div style={{ padding: '16px', borderTop: '1px solid #1e1e1e', background: '#111', display: 'flex', flexDirection: 'column', gap: '10px', flexShrink: 0 }}>
                        <textarea
                            placeholder="Ask the AI anything... (Enter to send)"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            rows={2}
                            style={{
                                width: '100%', background: '#1a1a1a', border: '1px solid #333',
                                borderRadius: '8px', color: '#eee', padding: '12px',
                                fontFamily: 'inherit', fontSize: '13px', resize: 'none',
                                outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.2s',
                            }}
                            onFocus={e => e.target.style.borderColor = '#00ff88'}
                            onBlur={e => e.target.style.borderColor = '#333'}
                        />
                        <button
                            onClick={handleSendChat}
                            disabled={isAnalyzing || !chatInput.trim()}
                            style={{
                                alignSelf: 'flex-end',
                                background: (isAnalyzing || !chatInput.trim()) ? '#333' : '#00ff88',
                                color: (isAnalyzing || !chatInput.trim()) ? '#888' : '#000',
                                border: 'none', padding: '8px 16px', borderRadius: '6px',
                                fontWeight: 'bold', cursor: (isAnalyzing || !chatInput.trim()) ? 'not-allowed' : 'pointer',
                                fontSize: '12px', transition: 'all 0.2s',
                            }}
                            onMouseEnter={e => { if (!isAnalyzing && chatInput.trim()) e.currentTarget.style.background = '#00e077'; }}
                            onMouseLeave={e => { if (!isAnalyzing && chatInput.trim()) e.currentTarget.style.background = '#00ff88'; }}
                        >
                            Send
                        </button>
                    </div>
                </div>
            </div>

            {/* ══════════════════════════════════════════════════════════════════
                DIFF OVERLAY — full-screen modal over everything
            ══════════════════════════════════════════════════════════════════ */}
            {diffPayload && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 1000,
                    background: 'rgba(0,0,0,0.85)',
                    display: 'flex', flexDirection: 'column',
                    backdropFilter: 'blur(4px)',
                }}>
                    {/* Diff header bar */}
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        background: '#0d1117', padding: '14px 24px',
                        borderBottom: '1px solid #30363d', flexShrink: 0,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <span style={{ fontSize: '15px', fontWeight: 700, color: '#eee' }}>🔍 Review AI Changes</span>
                            <span style={{ fontSize: '12px', color: '#555' }}>
                                <span style={{ color: '#f87171' }}>■ removed</span>
                                {'  '}
                                <span style={{ color: '#4ade80' }}>■ added</span>
                            </span>
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                                onClick={() => setDiffPayload(null)}
                                style={{
                                    background: '#1e1e1e', color: '#f87171', border: '1px solid #f87171',
                                    padding: '8px 20px', borderRadius: '8px', fontSize: '13px',
                                    fontWeight: 'bold', cursor: 'pointer',
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = '#3b0000'}
                                onMouseLeave={e => e.currentTarget.style.background = '#1e1e1e'}
                            >
                                ✕ Reject
                            </button>
                            <button
                                onClick={handleAcceptDiff}
                                style={{
                                    background: '#166534', color: '#4ade80', border: '1px solid #4ade80',
                                    padding: '8px 20px', borderRadius: '8px', fontSize: '13px',
                                    fontWeight: 'bold', cursor: 'pointer',
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = '#14532d'}
                                onMouseLeave={e => e.currentTarget.style.background = '#166534'}
                            >
                                ✓ Accept & Apply
                            </button>
                        </div>
                    </div>

                    {/* Column labels */}
                    <div style={{ display: 'flex', background: '#0d1117', flexShrink: 0 }}>
                        <div style={{ flex: 1, padding: '6px 24px', fontSize: '12px', color: '#f87171', borderBottom: '2px solid #f87171', textAlign: 'center', letterSpacing: '1px', textTransform: 'uppercase' }}>
                            Original (Your Code)
                        </div>
                        <div style={{ flex: 1, padding: '6px 24px', fontSize: '12px', color: '#4ade80', borderBottom: '2px solid #4ade80', textAlign: 'center', letterSpacing: '1px', textTransform: 'uppercase' }}>
                            AI Suggestion
                        </div>
                    </div>

                    {/* Monaco Diff Editor fills the rest */}
                    <div ref={diffContainerRef} style={{ flex: 1, minHeight: 0 }} />
                </div>
            )}
        </div>
    );
}