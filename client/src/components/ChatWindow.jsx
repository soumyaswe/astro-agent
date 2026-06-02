import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import '../styles/ChatWindow.css';

const LANGGRAPH_API_URL =
  import.meta.env.VITE_LANGGRAPH_API_URL || 'http://localhost:3000/api/chat';

/**
 * ChatWindow
 * Core chat UI with SSE streaming support.
 */
export default function ChatWindow({ userId, activeSessionId, onSessionCreated, userProfile }) {
  const [messages, setMessages] = useState([]); // { role: 'user'|'assistant', content: string }
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolStatus, setToolStatus] = useState(null); // temporary tool indicator
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(activeSessionId);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);

  // Sync session id from parent
  useEffect(() => {
    setCurrentSessionId(activeSessionId);
  }, [activeSessionId]);

  // Load history when session changes
  useEffect(() => {
    if (currentSessionId) {
      loadHistory(currentSessionId);
    } else {
      setMessages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId]);

  // Auto-scroll to bottom whenever messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, toolStatus]);

  const loadHistory = async (sessionId) => {
    setLoadingHistory(true);
    setMessages([]);

    const { data, error } = await supabase
      .from('langgraph_checkpoints')
      .select('message_history')
      .eq('thread_id', sessionId)
      .maybeSingle();

    setLoadingHistory(false);

    if (error) {
      console.error('Error loading history:', error.message);
      return;
    }

    if (data?.message_history && Array.isArray(data.message_history)) {
      // Normalize to our internal {role, content} format
      const normalized = data.message_history.map((msg) => ({
        role: msg.role || msg.type || 'assistant',
        content: msg.content || msg.text || '',
      }));
      setMessages(normalized);
    }
  };

  const createNewSession = async () => {
    const { data, error } = await supabase
      .from('chat_sessions')
      .insert({ userId })
      .select('id')
      .single();

    if (error) {
      console.error('Failed to create session:', error.message);
      return null;
    }

    const newId = data.id;
    setCurrentSessionId(newId);
    onSessionCreated?.(newId);

    // Refresh sidebar history list
    window.__sidebarRefresh?.();

    return newId;
  };

  // Parse a single SSE line buffer into {event, data}
  const parseSSEChunk = (raw) => {
    const lines = raw.split('\n');
    let event = null;
    let dataStr = '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataStr += line.slice(5).trim();
      }
    }

    try {
      const parsed = dataStr ? JSON.parse(dataStr) : null;
      return { event, data: parsed, rawData: dataStr };
    } catch {
      return { event, data: null, rawData: dataStr };
    }
  };

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput('');
    setToolStatus(null);

    // Append user message immediately
    const userMsg = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);

    // Ensure we have a session
    let sessionId = currentSessionId;
    if (!sessionId) {
      sessionId = await createNewSession();
      if (!sessionId) return;
    }

    // Placeholder for assistant's streaming response
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);
    setIsStreaming(true);

    // Cancel any in-flight request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(LANGGRAPH_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          userId,
          thread_id: sessionId,
          userProfile,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      // Read as a ReadableStream
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by double newlines
        const parts = buffer.split('\n\n');
        buffer = parts.pop(); // keep incomplete trailing chunk

        for (const part of parts) {
          if (!part.trim()) continue;
          const { event, data, rawData } = parseSSEChunk(part);

          // Handle token streaming (LangChain / LangGraph event names)
          if (
            event === 'token' ||
            event === 'on_chat_model_stream' ||
            data?.type === 'token' ||
            data?.event === 'on_chat_model_stream'
          ) {
            const chunk =
              data?.chunk?.content ||
              data?.content ||
              data?.token ||
              rawData ||
              '';

            setMessages((prev) => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (updated[lastIdx]?.role === 'assistant') {
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  content: updated[lastIdx].content + chunk,
                };
              }
              return updated;
            });
            setToolStatus(null);
          }

          // Tool / function calls — show a transient indicator
          else if (
            event === 'tool_start' ||
            data?.type === 'tool_start' ||
            data?.event === 'on_tool_start'
          ) {
            const toolName = data?.name || data?.tool || 'the stars';
            setToolStatus(`Consulting ${toolName}…`);
          }

          // End of stream
          else if (
            event === 'end' ||
            data?.type === 'end' ||
            event === 'done'
          ) {
            setToolStatus(null);
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Streaming error:', err);
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (updated[lastIdx]?.role === 'assistant' && updated[lastIdx].content === '') {
            updated[lastIdx] = {
              ...updated[lastIdx],
              content: '⚠ Something went wrong. Please try again.',
            };
          }
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
      setToolStatus(null);
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, isStreaming, currentSessionId, userId, userProfile]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isEmpty = messages.length === 0 && !loadingHistory;

  return (
    <main className="chat-window">
      {/* Messages area */}
      <div className="messages-area">
        {loadingHistory ? (
          <div className="chat-center-state">
            <span className="spinner" />
            <p>Loading conversation…</p>
          </div>
        ) : isEmpty ? (
          <div className="chat-empty-state">
            <div className="empty-icon">✦</div>
            <h2>What does the cosmos say?</h2>
            <p>Ask about your horoscope, birth chart, or anything astrology.</p>
            <div className="suggestion-chips">
              {[
                'What does my birth chart say?',
                "Today's horoscope for me",
                'Which planets are currently retrograde?',
                'Tell me about my rising sign',
              ].map((s) => (
                <button
                  key={s}
                  className="chip"
                  onClick={() => {
                    setInput(s);
                    inputRef.current?.focus();
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="messages-list">
            {messages.map((msg, idx) => (
              <div key={idx} className={`message message--${msg.role}`}>
                <div className="message-avatar">
                  {msg.role === 'user' ? '👤' : '✦'}
                </div>
                <div className="message-bubble">
                  {msg.content ? (
                    // Preserve newlines
                    msg.content.split('\n').map((line, i) => (
                      <span key={i}>
                        {line}
                        {i < msg.content.split('\n').length - 1 && <br />}
                      </span>
                    ))
                  ) : (
                    // Streaming cursor for empty assistant bubble
                    msg.role === 'assistant' && <span className="cursor-blink">▌</span>
                  )}
                </div>
              </div>
            ))}

            {/* Tool indicator */}
            {toolStatus && (
              <div className="tool-indicator">
                <span className="spinner-sm" />
                <span>{toolStatus}</span>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="input-area">
        <div className="input-wrapper">
          <textarea
            ref={inputRef}
            id="chat-input"
            className="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your stars…"
            rows={1}
            disabled={isStreaming}
            aria-label="Message input"
          />
          <button
            id="send-btn"
            className="send-btn"
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            aria-label="Send message"
          >
            {isStreaming ? (
              <span className="spinner-sm spinner-sm--white" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
        <p className="input-hint">
          Press <kbd>Enter</kbd> to send · <kbd>Shift+Enter</kbd> for new line
        </p>
      </div>
    </main>
  );
}
