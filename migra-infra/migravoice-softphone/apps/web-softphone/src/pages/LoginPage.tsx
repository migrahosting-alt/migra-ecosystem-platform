import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadConfig } from '@migravoice/config';
import { useSessionStore } from '../hooks/useSessionStore';
import { getApiOrigin } from '../lib/apiOrigin';
import { consumePortalLaunchSession, getPortalLaunchToken } from '../lib/portalLaunch';
import BuildStamp from '../components/BuildStamp';

export default function LoginPage() {
  const navigate = useNavigate();
  const { setSession, setSipCredentials, setLoading: setStoreLoading } = useSessionStore();

  const [mode, setMode] = useState<'extension' | 'email'>('extension');
  const [extension, setExtension] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [launchingFromPortal, setLaunchingFromPortal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config = loadConfig();

  useEffect(() => {
    const portalToken = getPortalLaunchToken();
    if (!portalToken) return;

    setLaunchingFromPortal(true);
    setLoading(true);
    setError(null);

    let cancelled = false;

    (async () => {
      try {
        await consumePortalLaunchSession({
          sipDomain: config.voip.sipDomain,
        });

        if (cancelled) return;

        setStoreLoading(false);
        navigate('/dialer', { replace: true });
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Portal sign-in failed');
        setLaunchingFromPortal(false);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [config.voip.sipDomain, navigate, setStoreLoading]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();

    if (mode === 'extension' && (!extension || !password)) {
      setError('Please enter extension and password');
      return;
    }
    if (mode === 'email' && (!email || !password)) {
      setError('Please enter email and password');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Use same origin for auth, since nginx proxies /auth/ to backend
      const authBase = `${getApiOrigin()}/auth`;

      const endpoint = mode === 'extension'
        ? `${authBase}/extension-login`
        : `${authBase}/login`;

      const body = mode === 'extension'
        ? { extension, password }
        : { email, password };

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Migra-Client-Platform': 'web',
          'X-Migra-Client-App': 'web-softphone',
        },
        body: JSON.stringify(body),
      });

      const data = await resp.json();

      if (!resp.ok) {
        throw new Error(data.error || 'Login failed');
      }

      if (!data.sipCredentials) {
        throw new Error(data.sipAssignment?.message || 'Web softphone is not provisioned for this account');
      }

      // Map API response to store types
      const session = {
        accessToken: data.session.accessToken,
        refreshToken: data.session.accessToken, // Use same token
        expiresAt: data.session.expiresAt,
        userId: data.session.userId,
        email: data.session.email,
      };

      setSession(session);

      if (data.sipCredentials) {
        const sipCreds = {
          username: data.sipCredentials.username,
          password: data.sipCredentials.password,
          domain: config.voip.sipDomain || data.sipCredentials.server,
          server: data.sipCredentials.server,
          displayName: data.sipCredentials.displayName || data.session.name,
          tenantId: data.session.tenantId,
          userId: data.session.userId,
        };
        setSipCredentials(sipCreds);
      }

      setStoreLoading(false);
      navigate('/dialer');
    } catch (err: any) {
      setError(err?.message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-bg p-4">
      {/* Background gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-brand-700/20 via-transparent to-accent-400/20" />

      <div className="w-full max-w-md relative z-10">
        <div className="bg-dark-surface rounded-2xl shadow-2xl border border-dark-border p-8">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <img
                src="/migra-logo-192.png"
                alt="MigraVoice"
                className="w-20 h-20 drop-shadow-glow"
              />
            </div>
            <h1 className="text-3xl font-display font-bold bg-gradient-to-r from-brand-700 via-brand to-accent-400 bg-clip-text text-transparent">
              MigraVoice
            </h1>
            <p className="text-gray-400 mt-2">Enterprise Softphone</p>
          </div>

          {/* Login mode toggle */}
          <div className="flex bg-dark-bg rounded-lg p-1 mb-6">
            <button
              type="button"
              onClick={() => setMode('extension')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                mode === 'extension'
                  ? 'bg-brand/20 text-brand-300'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Extension
            </button>
            <button
              type="button"
              onClick={() => setMode('email')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                mode === 'email'
                  ? 'bg-brand/20 text-brand-300'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Email
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-5">
            {launchingFromPortal && (
              <div className="bg-brand/10 border border-brand/30 text-brand-200 rounded-lg px-4 py-3 text-sm">
                Signing you in securely from the client portal...
              </div>
            )}

            {error && (
              <div className="bg-error/10 border border-error/30 text-error rounded-lg px-4 py-3 text-sm">
                {error}
              </div>
            )}

            {mode === 'extension' ? (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Extension
                </label>
                <input
                  type="text"
                  value={extension}
                  onChange={(e) => setExtension(e.target.value)}
                  className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition-all"
                  placeholder="201"
                  autoComplete="username"
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition-all"
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition-all"
                placeholder={mode === 'extension' ? 'Enter your password' : 'Enter your password'}
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading || launchingFromPortal}
              className="w-full py-3 px-4 bg-gradient-to-r from-brand-700 via-brand to-accent-400 text-white font-semibold rounded-xl shadow-lg shadow-brand/30 hover:shadow-brand/50 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          {/* Help text */}
          <p className="text-center text-gray-500 text-sm mt-6">
            {mode === 'extension'
              ? 'Sign in with your phone extension'
              : 'Sign in with your account email'}
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-gray-600 text-xs mt-6">
          <span className="bg-gradient-to-r from-brand-700 via-brand to-accent-400 bg-clip-text text-transparent font-semibold">
            MigraVoice
          </span>
          <span className="ml-1">&copy; 2026</span>
        </p>
        <BuildStamp className="mt-2 text-center" />
      </div>
    </div>
  );
}
