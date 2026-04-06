'use client';

import { use, useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';

export default function Room({ params }: { params: Promise<{ id: string }> }) {

    const { id: roomId } = use(params);
    const editorRef = useRef<any>(null);

    // State for our two different connections
    const [isConnected, setIsConnected] = useState(false);
    const [isAiConnected, setIsAiConnected] = useState(false); // NEW: Tracks Python server status

    const providerRef = useRef<any>(null);
    const bindingRef = useRef<any>(null);
    const ydocRef = useRef<any>(null);
    const aiSocketRef = useRef<WebSocket | null>(null); // NEW: Holds our AI pipeline

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

    // NEW: Connect to Developer B's Python Server when the page loads
    useEffect(() => {
        // We connect to the exact port (8000) her FastAPI server is running on
        const ws = new WebSocket('ws://127.0.0.1:8000/ws/chat');

        ws.onopen = () => setIsAiConnected(true);

        // When the AI replies, we just pop up an alert for testing today!
        ws.onmessage = (event) => {
            alert("🧠 AI Responded: \n\n" + event.data);
        };

        ws.onclose = () => setIsAiConnected(false);
        aiSocketRef.current = ws;

        return () => {
            ws.close();
        };
    }, []);

    // NEW: The function that runs when you click "Ask AI"
    const handleAskAI = () => {
        if (!aiSocketRef.current || !isAiConnected) {
            alert("AI Brain is offline! Tell Developer B to start her Python server.");
            return;
        }

        // Grab the exact text sitting inside the Monaco Editor right now
        const currentCode = editorRef.current.getValue();

        // Send it through the WebSocke tunnel!
        aiSocketRef.current.send(currentCode);
    };

    useEffect(() => {
        return () => {
            if (bindingRef.current) bindingRef.current.destroy();
            if (providerRef.current) providerRef.current.destroy();
            if (ydocRef.current) ydocRef.current.destroy();
        };
    }, []);

    return (
        <div className="flex flex-col h-screen w-full bg-[#1e1e1e]">

            <div className="flex items-center justify-between bg-[#0d1117] p-4 border-b border-gray-800">
                <div className="text-xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
                    CodeCollab
                </div>

                <div className="text-sm flex items-center gap-6">
                    {/* Multiplayer Status */}
                    <div className="flex items-center gap-2">
                        {isConnected ? (
                            <><div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div><span className="text-gray-400">Live: <span className="text-white">{roomId}</span></span></>
                        ) : (
                            <><div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></div><span className="text-gray-400">Connecting...</span></>
                        )}
                    </div>

                    {/* NEW: AI Status Indicator */}
                    <div className="flex items-center gap-2 border-l border-gray-700 pl-6">
                        {isAiConnected ? (
                            <span className="text-xs text-green-400 border border-green-400/30 bg-green-400/10 px-2 py-1 rounded">AI Online</span>
                        ) : (
                            <span className="text-xs text-red-400 border border-red-400/30 bg-red-400/10 px-2 py-1 rounded">AI Offline</span>
                        )}
                    </div>
                </div>

                <div className="flex gap-3">
                    {/* NEW: The Ask AI Button */}
                    <button
                        onClick={handleAskAI}
                        className="flex items-center gap-2 bg-purple-600 text-white px-4 py-2 rounded-md text-sm font-semibold hover:bg-purple-700 transition-colors shadow-[0_0_10px_rgba(147,51,234,0.2)]"
                    >
                        ✨ Ask AI
                    </button>
                    <button className="bg-white text-black px-4 py-2 rounded-md text-sm font-semibold hover:bg-gray-200 transition-colors">
                        Share Link
                    </button>
                </div>
            </div>

            <div className="flex-grow">
                <Editor
                    height="100%"
                    theme="vs-dark"
                    defaultLanguage="javascript"
                    onMount={handleEditorDidMount}
                    options={{ minimap: { enabled: false }, fontSize: 16, padding: { top: 20 } }}
                />
            </div>

        </div>
    );
}