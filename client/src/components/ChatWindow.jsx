import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { supabase } from '../lib/supabase';
import '../styles/ChatWindow.css';

// ── Error Boundary: catches ReactMarkdown parse crashes mid-stream ──
class MarkdownErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.warn('[MarkdownErrorBoundary] Caught render error:', error?.message);
  }

  // Reset when new content arrives so the next chunk gets a fresh attempt
  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.children !== this.props.children) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      // Fallback: render the raw text if the Markdown parser fails
      return <span className="whitespace-pre-wrap">{this.props.fallbackText}</span>;
    }
    return this.props.children;
  }
}

// Strip leaked intent JSON — bulletproof: only runs .replace on real strings
const cleanIntent = (text) => {
  if (!text || typeof text !== 'string') return '';
  try {
    return text.replace(/\{"intent":\s*"[^"]*"\}\s*/g, '');
  } catch {
    return text;
  }
};

const LANGGRAPH_API_URL =
  import.meta.env.VITE_LANGGRAPH_API_URL || 'http://localhost:4000/api/chat';

// Stable unique ID for each message
let _msgId = 0;
const nextId = () => `msg-${++_msgId}`;

export default function ChatWindow({ userId, activeSessionId, onSessionCreated, userProfile }) {
  const [messages, setMessages] = useState([]); // { id, role: 'user'|'assistant', content }
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeTool, setActiveTool] = useState(null); // name of currently running tool
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Refs
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);
  const isCreatingSessionRef = useRef(false);

  //Load history when session changes
  useEffect(() => {
    if (activeSessionId) {
      if (isCreatingSessionRef.current) {
        isCreatingSessionRef.current = false;
      } else {
        loadHistory(activeSessionId);
      }
    } else {
      setMessages([]);
    }
  }, [activeSessionId]);

  //Auto-scroll on new messages or tool updates
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTool]);

  //Load chat history from langgraph_checkpoints
  const loadHistory = async (sessionId) => {
    setLoadingHistory(true);
    setMessages([]);

    try {
      const { data, error } = await supabase
        .from('langgraph_checkpoints')
        .select('message_history')
        .eq('thread_id', sessionId)
        .single();

      if (error) {
        console.error('Error loading history:', error.message);
      } else if (data && Array.isArray(data.message_history)) {
        // Filter out tool calls, tool responses, and system messages
        const validMessages = data.message_history.filter((msg) => {
          const type = msg.role || msg.type || 'assistant';
          if (type === 'tool' || type === 'system') return false;
          
          // Hide assistant messages that are purely function call intents
          if (type === 'assistant' || type === 'ai') {
            const contentStr = String(msg.content || '').trim();
            if (contentStr === '' || contentStr.startsWith('[{"type":"functionCall"')) {
              return false;
            }
          }
          return true;
        });

        const formattedHistory = validMessages.map((msg) => {
          let role = 'assistant';
          const type = msg.role || msg.type || 'assistant';
          if (type === 'human' || type === 'user') {
            role = 'user';
          }
          
          return {
            id: nextId(),
            role: role,
            content: String(msg.content || ''),
          };
        });
        setMessages(formattedHistory);
      }
    } catch (err) {
      console.error('Unexpected error fetching history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };



  //SSE chunk parser
  const parseSSEBlock = (block) => {
    const lines = block.split('\n');
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
      return { event, data: dataStr ? JSON.parse(dataStr) : null, rawData: dataStr };
    } catch {
      return { event, data: null, rawData: dataStr };
    }
  };

  // Safely coerce any chunk value to a plain string
  const safeChunkToString = (raw) => {
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) {
      return raw
        .filter((c) => c && c.type === 'text')
        .map((c) => String(c.text ?? ''))
        .join('');
    }
    if (raw == null) return '';
    return String(raw);
  };

  //Core streaming function — wrapped in outer try/catch for total safety
  const sendMessage = useCallback(async (e) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput('');
    setActiveTool(null);

    // 1. Append user message immediately
    setMessages((prev) => [...(prev || []), { id: nextId(), role: 'user', content: text }]);

    // 2. Ensure we have a session (Race Condition Fix)
    let sessionIdForFetch = activeSessionId;

    if (!sessionIdForFetch) {
      try {
        let sessionTitle = text.trim();
        if (sessionTitle.length > 30) {
          sessionTitle = sessionTitle.substring(0, 27) + '...';
        }

        const { data, error } = await supabase
          .from('chat_sessions')
          .insert({ 
            user_id: userId,
            title: sessionTitle
          })
          .select('id')
          .single();
          
        if (error) throw error;
        if (data) {
          sessionIdForFetch = data.id;
          // IMPORTANT: Bypass loadHistory wipeout for this newly created session
          isCreatingSessionRef.current = true;
          // Call the prop callback
          onSessionCreated?.(data.id); 
          window.__sidebarRefresh?.();
        }
      } catch (sessionErr) {
        console.error('[ChatWindow] Failed to create session:', sessionErr);
        return;
      }
      if (!sessionIdForFetch) return;
    }

    // 3. Add an empty assistant placeholder — tokens stream into this
    const assistantId = nextId();
    setMessages((prev) => [...(prev || []), { id: assistantId, role: 'assistant', content: '' }]);
    setIsStreaming(true);

    // 4. Cancel any previous in-flight request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const apiUrl = import.meta.env.VITE_LANGGRAPH_API_URL || LANGGRAPH_API_URL;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          userId,
          thread_id: sessionIdForFetch, 
          userProfile,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      // 5. Read the response body as a ReadableStream — guard against null body
      if (!response.body) {
        throw new Error('Response body is empty');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by double newlines (\n\n)
        const parts = buffer.split('\n\n');
        buffer = parts.pop(); // hold the incomplete trailing chunk

        for (const block of parts) {
          if (!block.trim()) continue;

          let parsed;
          try {
            parsed = parseSSEBlock(block);
          } catch (parseErr) {
            console.warn('[ChatWindow] Failed to parse SSE block:', parseErr);
            continue;
          }

          const { event, data, rawData } = parsed;

          //Token streaming 
          if (
            event === 'token' ||
            event === 'on_chat_model_stream' ||
            data?.type === 'token' ||
            data?.event === 'on_chat_model_stream'
          ) {
            const rawChunk =
              data?.chunk?.content ??
              data?.content ??
              data?.value ??
              data?.token ??
              rawData ??
              '';

            const chunk = safeChunkToString(rawChunk);
            if (!chunk) continue; // skip empty tokens

            // Strict React immutability — brand new array + brand new object
            setMessages((prev) => {
              if (!prev || prev.length === 0) return prev;

              const lastIndex = prev.length - 1;
              const lastMessage = prev[lastIndex];

              // Only append if the last message belongs to the assistant
              if (lastMessage.role !== 'assistant') return prev;

              // 1. Ensure the incoming chunk is actually a string
              const safeChunk = typeof chunk === 'string' ? chunk : '';

              // 2. Combine the old text with the new chunk safely
              const combinedText = (lastMessage.content || '') + safeChunk;

              // 3. Create a BRAND NEW object and array to satisfy React immutability
              const updatedMessages = [...prev];
              updatedMessages[lastIndex] = {
                ...lastMessage,
                content: combinedText,
              };

              return updatedMessages;
            });

            setActiveTool(null); // clear tool indicator when tokens flow
          }

          // Tool start 
          else if (
            event === 'tool_start' ||
            data?.type === 'tool_start' ||
            data?.event === 'on_tool_start'
          ) {
            const toolName =
              data?.name || data?.tool || data?.input?.tool || 'the cosmos';
            setActiveTool(toolName);
          }

          //Tool end
          else if (
            event === 'tool_end' ||
            data?.type === 'tool_end' ||
            data?.event === 'on_tool_end'
          ) {
  
          }

          // Stream end
          else if (
            event === 'end' ||
            event === 'done' ||
            data?.type === 'end'
          ) {
            setActiveTool(null);
          }
        }
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        console.error('[ChatWindow] Streaming error:', err);
        // Replace empty assistant bubble with an error message
        setMessages((prev) => {
          if (!prev || prev.length === 0) return prev;
          return prev.map((msg) =>
            msg.id === assistantId && !msg.content
              ? { ...msg, content: '⚠ Something went wrong. Please try again.' }
              : msg
          );
        });
      }
    } finally {
      setIsStreaming(false);
      setActiveTool(null);
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, isStreaming, activeSessionId, userId, userProfile]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isEmpty = messages.length === 0 && !loadingHistory;

  return (
    <main className="chat-window">
      {/*  Messages area */}
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
            {messages?.map((message, index) => {
              // 1. Grab the raw string safely
              const displayContent = typeof message.content === 'string' ? message.content : "";

              return (
                <div key={index} className={`message message--${message.role || 'assistant'}`}>
                  <div className="message-avatar">
                    {message.role === 'user' ? '👤' : '✦'}
                  </div>
                  <div className="message-bubble">
                    {message.role === 'user' ? (
                      <span className="whitespace-pre-wrap">{displayContent}</span>
                    ) : (
                      <MarkdownErrorBoundary fallbackText={displayContent}>
                        {/* The parser only gets safe, clean text now */}
                        <div className="markdown-body">
                          <ReactMarkdown>
                            {displayContent}
                          </ReactMarkdown>
                        </div>
                      </MarkdownErrorBoundary>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Scroll anchor */}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/*  Input area  */}
      <div className="input-area">
        {/* Tool indicator — shown above the input while a tool runs */}
        {activeTool && (
          <div className="tool-indicator" role="status" aria-live="polite">
            <span className="tool-indicator-dot" />
            <span> Using tool: <strong>{activeTool}</strong>…</span>
          </div>
        )}

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
            onClick={(e) => {
              e.preventDefault();
              sendMessage();
            }}
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
