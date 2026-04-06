'use client';

import { use, useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';

// Notice we REMOVED the Yjs and WebRTC imports from up here!

export default function Room({ params }: { params: Promise<{ id: string }> }) {

    const { id: roomId } = use(params);
    const editorRef = useRef<any>(null);
    const [isConnected, setIsConnected] = useState(false);

    const providerRef = useRef<any>(null);
    const bindingRef = useRef<any>(null);
    const ydocRef = useRef<any>(null);

    // 1. We made this function ASYNC so we can load tools on the fly
    const handleEditorDidMount = async (editor: any, monaco: any) => {
        editorRef.current = editor;

        // 2. DYNAMIC IMPORTS: We load the browser-only tools right here!
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

                <div className="text-sm flex items-center gap-2">
                    {isConnected ? (
                        <>
                            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                            <span className="text-gray-400">Live in Room: <span className="font-mono text-white">{roomId}</span></span>
                        </>
                    ) : (
                        <>
                            <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse"></div>
                            <span className="text-gray-400">Connecting...</span>
                        </>
                    )}
                </div>

                <button className="bg-white text-black px-4 py-2 rounded-md text-sm font-semibold hover:bg-gray-200 transition-colors">
                    Share Link
                </button>
            </div>

            <div className="flex-grow">
                <Editor
                    height="100%"
                    theme="vs-dark"
                    defaultLanguage="javascript"
                    onMount={handleEditorDidMount} // Our newly updated function
                    options={{
                        minimap: { enabled: false },
                        fontSize: 16,
                        wordWrap: 'on',
                        padding: { top: 20 },
                    }}
                />
            </div>

        </div>
    );
}