import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'

export function createSyncEngine(roomId: string) {
    const doc = new Y.Doc()

    const sharedText = doc.getText('monaco-content')

    const provider = new WebrtcProvider(roomId, doc, {
        signaling: ['wss://signaling.yjs.dev'],
    })

    const awareness = provider.awareness

    return { doc, sharedText, provider, awareness }
}