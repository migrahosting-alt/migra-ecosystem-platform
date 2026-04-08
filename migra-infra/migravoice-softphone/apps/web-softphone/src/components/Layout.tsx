import { NavLink, Outlet } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useVoipClient } from '../hooks/useVoipClient';
import { useVoicemailStore } from '../hooks/useVoicemailStore';
import { useMessagesStore } from '../hooks/useMessagesStore';
import { useAgentStatusStore, statusConfig } from '../hooks/useAgentStatusStore';
import { useSessionStore } from '../hooks/useSessionStore';

const navItems = [
  { to: '/dialer', icon: '📞', label: 'Dialer', badge: null, section: 'main' },
  { to: '/calls', icon: '📋', label: 'Call History', badge: null, section: 'main' },
  { to: '/contacts', icon: '📇', label: 'Contacts', badge: null, section: 'main' },
  { to: '/messages', icon: '💬', label: 'Messages', badge: 'messages', section: 'comm' },
  { to: '/voicemail', icon: '📬', label: 'Voicemail', badge: 'voicemail', section: 'comm' },
  { to: '/transcriptions', icon: '✨', label: 'AI Transcriptions', badge: null, section: 'ai' },
  { to: '/team', icon: '👥', label: 'Team', badge: null, section: 'manage' },
  { to: '/analytics', icon: '📊', label: 'Analytics', badge: null, section: 'manage' },
  { to: '/settings', icon: '⚙️', label: 'Settings', badge: null, section: 'system' },
];

const sectionLabels: Record<string, string> = {
  main: 'Phone',
  comm: 'Communication',
  ai: 'AI Features',
  manage: 'Management',
  system: 'System',
};

export default function Layout() {
  const { registered, registering, lastError } = useVoipClient();
  const { newMessages: newVoicemails } = useVoicemailStore();
  const { unreadTotal: unreadMessages } = useMessagesStore();
  const { myStatus, setMyStatus } = useAgentStatusStore();
  const { session, logout } = useSessionStore();
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => { setMobileMenuOpen(false); }, []);

  const sipStatus = registered ? 'Registered' : registering ? 'Connecting…' : 'Offline';
  const sipColor = registered ? 'bg-green-500' : registering ? 'bg-yellow-500 animate-pulse' : 'bg-red-500';

  const getBadge = (key: string | null) => {
    if (key === 'voicemail') return newVoicemails;
    if (key === 'messages') return unreadMessages;
    return 0;
  };

  // Group nav items by section
  const sections = Object.keys(sectionLabels);

  // Bottom nav items for mobile (subset)
  const mobileNav = navItems.filter(i => ['main', 'comm', 'manage'].includes(i.section)).slice(0, 5);

  return (
    <div className="h-screen flex flex-col md:flex-row bg-gray-50">
      {/* ── Mobile Top Bar ── */}
      <div className="md:hidden flex items-center justify-between bg-gradient-to-r from-brand-700 via-brand to-accent-400 px-4 py-2.5 flex-shrink-0 safe-top">
        <div className="flex items-center gap-2">
          <img src="/migra-logo-192.png" alt="MigraVoice" className="w-8 h-8" />
          <span className="text-base font-display font-bold text-white">MigraVoice</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${sipColor}`} />
          <span className="text-[11px] text-white/80">{sipStatus}</span>
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="ml-2 p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {mobileMenuOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              }
            </svg>
          </button>
        </div>
      </div>

      {/* ── Mobile slide-over menu ── */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex" style={{ top: 0 }}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          <div className="relative w-72 max-w-[80vw] bg-white h-full overflow-auto shadow-2xl animate-slide-in">
            {/* Mobile menu header */}
            <div className="bg-gradient-to-br from-brand-700 via-brand to-accent-400 px-4 py-5">
              <div className="flex items-center gap-3">
                <img src="/migra-logo-192.png" alt="MigraVoice" className="w-10 h-10" />
                <div>
                  <h1 className="text-lg font-display font-bold text-white">MigraVoice</h1>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${sipColor}`} />
                    <span className="text-xs text-white/80">{sipStatus}</span>
                  </div>
                </div>
              </div>
            </div>
            {/* Agent status */}
            <div className="px-3 py-2 border-b border-gray-100">
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg">
                <span className={`w-3 h-3 rounded-full flex-shrink-0 ${statusConfig[myStatus].bgColor}`} />
                <span className="text-sm font-medium text-gray-700">{statusConfig[myStatus].label}</span>
              </div>
            </div>
            {/* Nav items */}
            <div className="py-2">
              {sections.map(section => {
                const items = navItems.filter(i => i.section === section);
                if (!items.length) return null;
                return (
                  <div key={section} className="mb-1">
                    <p className="px-5 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{sectionLabels[section]}</p>
                    {items.map(item => {
                      const badgeCount = getBadge(item.badge);
                      return (
                        <NavLink key={item.to} to={item.to} onClick={() => setMobileMenuOpen(false)}
                          className={({ isActive }) =>
                            `flex items-center gap-3 px-4 py-2.5 mx-2 rounded-lg text-sm font-medium transition ${
                              isActive ? 'bg-brand/10 text-brand border-l-2 border-brand' : 'text-gray-600 hover:bg-gray-100 border-l-2 border-transparent'
                            }`
                          }>
                          <span className="text-lg">{item.icon}</span>
                          <span className="truncate">{item.label}</span>
                          {badgeCount > 0 && (
                            <span className="ml-auto bg-accent text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">{badgeCount}</span>
                          )}
                        </NavLink>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            {/* User section */}
            <div className="border-t border-gray-100 p-3 mt-auto">
              <div className="flex items-center gap-3 p-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-700 to-accent-400 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                  {(session?.email?.charAt(0) || 'U').toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{session?.email || 'User'}</p>
                </div>
              </div>
              <button onClick={() => { logout(); setMobileMenuOpen(false); }}
                className="w-full mt-2 px-4 py-2 text-left text-sm text-red-500 hover:bg-red-50 transition rounded-lg flex items-center gap-2">
                🚪 Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Desktop Sidebar (hidden on mobile) ── */}
      <nav className={`hidden md:flex ${collapsed ? 'w-16' : 'w-64'} bg-white border-r border-gray-200 flex-col transition-all duration-200 flex-shrink-0`}>
        {/* Header */}
        <div className="bg-gradient-to-br from-brand-700 via-brand to-accent-400 p-3">
          <div className="flex items-center gap-3">
            <img src="/migra-logo-192.png" alt="MigraVoice" className="w-10 h-10 flex-shrink-0" />
            {!collapsed && (
              <div className="min-w-0">
                <h1 className="text-lg font-display font-bold text-white leading-tight">MigraVoice</h1>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${sipColor}`} />
                  <span className="text-[11px] text-white/80 truncate">{sipStatus}</span>
                </div>
              </div>
            )}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="ml-auto text-white/60 hover:text-white transition p-1"
            >
              {collapsed ? '→' : '←'}
            </button>
          </div>
        </div>

        {/* Connection Error Banner */}
        {!registered && !registering && lastError && !collapsed && (
          <div className="mx-2 mt-2 p-2 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-[10px] text-red-600 font-medium">SIP Error</p>
            <p className="text-[10px] text-red-500 truncate">{lastError}</p>
          </div>
        )}

        {/* Agent Status */}
        {!collapsed && (
          <div className="px-3 py-2 border-b border-gray-100 relative">
            <button
              onClick={() => setShowStatusMenu(!showStatusMenu)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition"
            >
              <span className={`w-3 h-3 rounded-full flex-shrink-0 ${statusConfig[myStatus].bgColor}`} />
              <span className="text-sm font-medium text-gray-700">{statusConfig[myStatus].label}</span>
              <span className="ml-auto text-gray-400 text-xs">▼</span>
            </button>
            {showStatusMenu && (
              <div className="absolute left-3 right-3 top-full mt-1 bg-white rounded-lg shadow-xl border border-gray-100 py-1 z-50">
                {Object.entries(statusConfig).map(([status, config]) => (
                  <button
                    key={status}
                    onClick={() => { setMyStatus(status as any); setShowStatusMenu(false); }}
                    className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-gray-50 transition ${
                      myStatus === status ? 'bg-brand/5 text-brand' : ''
                    }`}
                  >
                    <span className={`w-3 h-3 rounded-full ${config.bgColor}`} />
                    {config.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex-1 py-2 overflow-auto">
          {sections.map(section => {
            const items = navItems.filter(i => i.section === section);
            if (items.length === 0) return null;
            return (
              <div key={section} className="mb-1">
                {!collapsed && (
                  <p className="px-5 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">{sectionLabels[section]}</p>
                )}
                {items.map((item) => {
                  const badgeCount = getBadge(item.badge);
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        `flex items-center gap-3 ${collapsed ? 'justify-center px-2' : 'px-4'} py-2 mx-2 rounded-lg text-sm font-medium transition ${
                          isActive
                            ? 'bg-brand/10 text-brand border-l-2 border-brand'
                            : 'text-gray-600 hover:bg-gray-100 border-l-2 border-transparent'
                        }`
                      }
                    >
                      <span className="text-lg flex-shrink-0">{item.icon}</span>
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {badgeCount > 0 && (
                        <span className={`${collapsed ? 'absolute top-0 right-0' : 'ml-auto'} bg-accent text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1`}>
                          {badgeCount}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* User / Footer */}
        <div className="border-t border-gray-100">
          {!collapsed ? (
            <div className="p-3 relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-700 to-accent-400 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                  {(session?.email?.charAt(0) || 'U').toUpperCase()}
                </div>
                <div className="min-w-0 text-left">
                  <p className="text-sm font-medium text-gray-800 truncate">{session?.email || 'User'}</p>
                  <p className="text-[10px] text-gray-400">
                    {registered ? '🟢 SIP Active' : '🔴 SIP Offline'}
                  </p>
                </div>
              </button>
              {showUserMenu && (
                <div className="absolute bottom-full left-3 right-3 mb-2 bg-white rounded-lg shadow-xl border border-gray-100 py-1 z-50">
                  <button
                    onClick={() => { logout(); setShowUserMenu(false); }}
                    className="w-full px-4 py-2 text-left text-sm text-red-500 hover:bg-red-50 transition flex items-center gap-2"
                  >
                    🚪 Sign Out
                  </button>
                </div>
              )}
              <p className="text-center mt-2">
                <span className="text-[10px] bg-gradient-to-r from-brand-700 via-brand to-accent-400 bg-clip-text text-transparent font-semibold">
                  MigraVoice
                </span>
                <span className="text-[10px] text-gray-400 ml-1">&copy; 2026</span>
              </p>
            </div>
          ) : (
            <div className="p-2 flex justify-center">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-700 to-accent-400 flex items-center justify-center text-white text-sm font-bold">
                {(session?.email?.charAt(0) || 'U').toUpperCase()}
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-auto min-h-0">
        <Outlet />
      </main>

      {/* ── Mobile Bottom Navigation ── */}
      <nav className="md:hidden flex-shrink-0 bg-white border-t border-gray-200 safe-bottom">
        <div className="flex items-center justify-around px-1 py-1">
          {mobileNav.map((item) => {
            const badgeCount = getBadge(item.badge);
            return (
              <NavLink key={item.to} to={item.to}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg text-[10px] font-medium transition relative ${
                    isActive ? 'text-brand' : 'text-gray-400 hover:text-gray-600'
                  }`
                }>
                <span className="text-lg leading-none">{item.icon}</span>
                <span className="truncate max-w-[56px]">{item.label.split(' ')[0]}</span>
                {badgeCount > 0 && (
                  <span className="absolute -top-0.5 right-0 bg-accent text-white text-[8px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">{badgeCount}</span>
                )}
              </NavLink>
            );
          })}
          <button onClick={() => setMobileMenuOpen(true)}
            className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-lg text-[10px] font-medium text-gray-400 hover:text-gray-600 transition">
            <span className="text-lg leading-none">☰</span>
            <span>More</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
