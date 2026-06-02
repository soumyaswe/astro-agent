import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import '../styles/Sidebar.css';

//sidebar
export default function Sidebar({
  userId,
  activeSessionId,
  onSessionSelect,
  onNewChat,
  onOpenProfile,
  userProfile,
  isMobileOpen,
  onMobileClose,
}) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    fetchSessions();
  }, [userId]);

  const fetchSessions = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('chat_sessions')
      .select('id, title, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setSessions(data);
    }
    setLoading(false);
  };

  // Expose refresh so parent can call after new session is created
  useEffect(() => {
    window.__sidebarRefresh = fetchSessions;
    return () => {
      delete window.__sidebarRefresh;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const formatDate = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const displayName = userProfile?.name || 'Cosmic Traveler';
  const initials = displayName
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <>
      {/* Mobile overlay */}
      {isMobileOpen && (
        <div className="sidebar-overlay" onClick={onMobileClose} />
      )}

      <aside className={`sidebar ${isMobileOpen ? 'sidebar--open' : ''}`}>
        {/* Brand */}
        <div className="sidebar-brand">
          <div className="brand-icon">✦</div>
          <span className="brand-name">AstroAgent</span>
          <button
            className="sidebar-mobile-close"
            onClick={onMobileClose}
            aria-label="Close sidebar"
          >
            ✕
          </button>
        </div>

        {/* New Chat */}
        <button id="new-chat-btn" className="btn-new-chat" onClick={onNewChat}>
          <span>＋</span> New Chat
        </button>

        {/* Sessions list */}
        <div className="sidebar-section-label">History</div>
        <nav className="sessions-list" aria-label="Chat history">
          {loading ? (
            <div className="sidebar-loading">
              <span className="spinner-sm" /> Loading…
            </div>
          ) : sessions.length === 0 ? (
            <p className="sidebar-empty">No chats yet. Start one above!</p>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                id={`session-${session.id}`}
                className={`session-item ${
                  activeSessionId === session.id ? 'session-item--active' : ''
                }`}
                onClick={() => {
                  onSessionSelect(session.id);
                  onMobileClose?.();
                }}
              >
                <span className="session-dot">◉</span>
                <span className="session-title">{session.title || 'Cosmic Session'}</span>
                <span className="session-date">{formatDate(session.created_at)}</span>
              </button>
            ))
          )}
        </nav>

        {/* User profile button */}
        <div className="sidebar-footer">
          <button
            id="profile-btn"
            className="profile-btn"
            onClick={onOpenProfile}
            title="Edit your birth profile"
          >
            <div className="profile-avatar">{initials || '✦'}</div>
            <div className="profile-info">
              <span className="profile-name">{displayName}</span>
              <span className="profile-subtitle">
                {userProfile ? '✓ Profile set' : 'Set birth details'}
              </span>
            </div>
            <span className="profile-edit-icon">✏</span>
          </button>
        </div>
      </aside>
    </>
  );
}
