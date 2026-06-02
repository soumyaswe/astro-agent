import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from './lib/supabase';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';
import BirthDetailsModal from './components/BirthDetailsModal';
import './styles/App.css';

const USER_ID_KEY = 'astroagent_user_id';

function getOrCreateUserId() {
  let id = localStorage.getItem(USER_ID_KEY);
  if (!id) {
    id = uuidv4();
    localStorage.setItem(USER_ID_KEY, id);
  }
  return id;
}

export default function App() {
  //Global State
  const [currentUserId] = useState(() => getOrCreateUserId());
  const [userProfile, setUserProfile] = useState(null);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false); // mobile

  // Load existing profile on mount
  useEffect(() => {
    if (!currentUserId) return;
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId]);

  const loadProfile = async () => {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', currentUserId)
      .maybeSingle();

    if (!error && data) {
      setUserProfile(data);
    } else if (!error && !data) {
      // First time user — open the modal automatically
      setIsModalOpen(true);
    }
  };

  const handleModalClose = (updatedProfile) => {
    setIsModalOpen(false);
    if (updatedProfile) {
      setUserProfile(updatedProfile);
    }
  };

  const handleNewChat = () => {
    setActiveSessionId(null);
    setIsSidebarOpen(false);
  };

  const handleSessionCreated = (newId) => {
    setActiveSessionId(newId);
  };

  return (
    <div className="app-layout">
      {/* Mobile topbar */}
      <header className="mobile-topbar">
        <button
          className="topbar-menu-btn"
          onClick={() => setIsSidebarOpen(true)}
          aria-label="Open sidebar"
        >
          ☰
        </button>
        <div className="topbar-brand">
          <span className="topbar-brand-icon">✦</span>
          AstroAgent
        </div>
        <button
          className="topbar-profile-btn"
          onClick={() => setIsModalOpen(true)}
          aria-label="Edit profile"
        >
          👤
        </button>
      </header>

      {/* Sidebar */}
      <Sidebar
        userId={currentUserId}
        activeSessionId={activeSessionId}
        onSessionSelect={setActiveSessionId}
        onNewChat={handleNewChat}
        onOpenProfile={() => setIsModalOpen(true)}
        userProfile={userProfile}
        isMobileOpen={isSidebarOpen}
        onMobileClose={() => setIsSidebarOpen(false)}
      />

      {/* Chat */}
      <ChatWindow
        userId={currentUserId}
        activeSessionId={activeSessionId}
        onSessionCreated={handleSessionCreated}
        userProfile={userProfile}
      />

      {/* Birth Details Modal */}
      {isModalOpen && (
        <BirthDetailsModal
          userId={currentUserId}
          onClose={handleModalClose}
          existingProfile={userProfile}
        />
      )}
    </div>
  );
}
