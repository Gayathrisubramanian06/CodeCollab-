'use client';

import { use } from 'react'; // <-- We imported this!
import Editor from '@monaco-editor/react';

// We updated the type to say params is a Promise
export default function Room({ params }: { params: Promise<{ id: string }> }) {

    // 1. We "unwrap" the promise to get the actual ID
    const unwrappedParams = use(params);

    return (
        <div className="flex flex-col h-screen w-full bg-[#1e1e1e]">

            {/* Top Navigation Bar */}
            <div className="flex items-center justify-between bg-[#0d1117] p-4 border-b border-gray-800">
                <div className="text-xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
                    CodeCollab
                </div>

                {/* We use unwrappedParams.id here! */}
                <div className="text-sm text-gray-400 flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                    Room: <span className="font-mono text-gray-200">{unwrappedParams.id}</span>
                </div>

                <button className="bg-white text-black px-4 py-2 rounded-md text-sm font-semibold hover:bg-gray-200 transition-colors">
                    Share Link
                </button>
            </div>

            {/* The Actual Code Editor */}
            <div className="flex-grow">
                <Editor
                    height="100%"
                    theme="vs-dark"
                    defaultLanguage="javascript"
                    defaultValue="// Welcome to CodeCollab!
// Start typing your JavaScript here...

function helloWorld() {
  console.log('We are live!');
}"
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