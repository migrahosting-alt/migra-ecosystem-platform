import BuildStamp from './BuildStamp';

interface UpdateBannerProps {
  visible: boolean;
  updateReady: boolean;
  offlineReady: boolean;
  releaseLabel: string;
  onReload?: () => void;
  onDismiss: () => void;
}

export default function UpdateBanner({
  visible,
  updateReady,
  offlineReady,
  releaseLabel,
  onReload,
  onDismiss,
}: UpdateBannerProps) {
  if (!visible) {
    return null;
  }

  return (
    <div className="fixed right-4 top-4 z-[70] w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-brand/20 bg-dark-surface/95 p-4 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-white">
            {updateReady ? 'Update ready to install' : 'Offline support is ready'}
          </p>
          <p className="mt-1 text-sm text-gray-400">
            {updateReady
              ? `A newer MigraVoice build is available. Reload to move to ${releaseLabel}.`
              : 'This device can now reopen the softphone shell faster when the network is unstable.'}
          </p>
          <BuildStamp className="mt-3" />
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg border border-white/10 px-2 py-1 text-xs text-gray-400 transition hover:border-white/20 hover:text-white"
        >
          Later
        </button>
      </div>
      {updateReady && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onReload}
            className="rounded-xl bg-gradient-to-r from-brand-700 via-brand to-accent-400 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-brand/30 transition hover:brightness-110"
          >
            Update now
          </button>
        </div>
      )}
    </div>
  );
}