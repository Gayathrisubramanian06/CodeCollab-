'use client'

import { useEffect, useRef, useState } from 'react'

interface Message {
    id: number
    type: 'user' | 'ai' | 'status'
    text: string
}

export default function AiPanel({ isOpen }: { isOpen: boolean }) {
    const [messages, setMessages] = useState<Message[]>([])
    const bottomRef = useRef<HTMLDivElement>(null)

    // Auto scroll to latest message
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    return (
        <div className={`ai-panel ${isOpen ? 'open' : ''}`}>
            {/* Header */}
            <div className="ai-panel-header">
                <span className="ai-dot" />
                <h2>AI Review</h2>
            </div>

            {/* Messages */}
            <div className="ai-messages">
                {messages.length === 0 && (
                    <div className="ai-empty">
                        Press <kbd>Analyze</kbd> to review your code
                    </div>
                )}
                {messages.map((msg) => (
                    <div key={msg.id} className={`ai-message ${msg.type}`}>
                        {msg.type === 'ai' && <span className="ai-label">🤖 AI</span>}
                        {msg.type === 'user' && <span className="ai-label">📝 Your Code</span>}
                        <p>{msg.text}</p>
                    </div>
                ))}
                <div ref={bottomRef} />
            </div>
        </div>
    )
}

// Export a way for other components to add messages
export type { Message }