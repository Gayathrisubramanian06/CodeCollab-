'use client'

import { useEffect, useRef } from 'react'
import Editor from '@monaco-editor/react'
import { createSyncEngine } from '@/app/lib/syncEngine'
import { MonacoBinding } from 'y-monaco'

export default function CollabEditor({ roomId }: { roomId: string }) {
    const editorRef = useRef<any>(null)

    function handleEditorMount(editor: any) {
        editorRef.current = editor

        // Create the sync engine with the room ID from the URL
        const { sharedText, awareness } = createSyncEngine(roomId)

        // Bind Yjs ↔ Monaco
        new MonacoBinding(
            sharedText,
            editor.getModel(),
            new Set([editor]),
            awareness
        )
    }

    return (
        <Editor
            height="100vh"
            defaultLanguage="javascript"
            theme="vs-dark"
            onMount={handleEditorMount}
        />
    )
}