import { useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { useSessionStore } from './hooks/useSessionStore';
import { useSipCredentialsFetcher } from './hooks/useSipCredentialsFetcher';
import UpdateBanner from './components/UpdateBanner';
import LoginPage from './pages/LoginPage';
import DialerPage from './pages/DialerPage';
import CallsPage from './pages/CallsPage';
import ContactsPage from './pages/ContactsPage';
import MessagesPage from './pages/MessagesPage';
import VoicemailPage from './pages/VoicemailPage';
import TeamPage from './pages/TeamPage';
import AnalyticsPage from './pages/AnalyticsPage';
import TranscriptionsPage from './pages/TranscriptionsPage';
import SettingsPage from './pages/SettingsPage';
import Layout from './components/Layout';
import ActiveCallModal from './components/ActiveCallModal';
import { releaseLabel } from './buildInfo';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useSessionStore();

  // Auto-fetch SIP credentials if session exists but creds are missing
  useSipCredentialsFetcher();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-bg">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-brand/30 border-t-brand rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const [updateReady, setUpdateReady] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const updateServiceWorkerRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || navigator.userAgent.includes('Electron')) {
      return;
    }

    let refreshInterval: number | undefined;
    let cleanupVisibility: (() => void) | undefined;

    updateServiceWorkerRef.current = registerSW({
      immediate: true,
      onOfflineReady() {
        setOfflineReady(true);
        setDismissed(false);
      },
      onNeedRefresh() {
        setUpdateReady(true);
        setDismissed(false);
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) {
          return;
        }

        const checkForUpdates = () => registration.update().catch(() => undefined);

        refreshInterval = window.setInterval(checkForUpdates, 15 * 60 * 1000);
        const handleVisibility = () => {
          if (document.visibilityState === 'visible') {
            checkForUpdates();
          }
        };

        document.addEventListener('visibilitychange', handleVisibility);
        cleanupVisibility = () => document.removeEventListener('visibilitychange', handleVisibility);
        checkForUpdates();
      },
    });

    return () => {
      if (refreshInterval) {
        window.clearInterval(refreshInterval);
      }
      cleanupVisibility?.();
    };
  }, []);

  return (
    <>
      <UpdateBanner
        updateReady={updateReady}
        offlineReady={offlineReady}
        releaseLabel={releaseLabel}
        onReload={() => updateServiceWorkerRef.current?.(true)}
        onDismiss={() => {
          setDismissed(true);
          setOfflineReady(false);
        }}
        visible={!dismissed && (updateReady || offlineReady)}
      />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dialer" replace />} />
          <Route path="dialer" element={<DialerPage />} />
          <Route path="calls" element={<CallsPage />} />
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="voicemail" element={<VoicemailPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="transcriptions" element={<TranscriptionsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      <ActiveCallModal />
    </>
  );
}
