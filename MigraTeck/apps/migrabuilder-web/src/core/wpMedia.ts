export type MediaPick = {
  id: number;
  url: string;
  alt?: string;
  title?: string;
  mime?: string;
};

type WpMediaFrame = {
  on: (event: string, cb: () => void) => void;
  open: () => void;
  state: () => { get: (key: string) => any };
};

declare global {
  interface Window {
    wp?: any;
  }
}

export async function pickMedia(opts: {
  title?: string;
  button?: string;
  libraryType?: 'image' | 'any';
}): Promise<MediaPick | null> {
  const wp = window.wp;
  if (!wp?.media) return null;

  return await new Promise((resolve) => {
    const frame = wp.media({
      title: opts.title || 'Select media',
      button: { text: opts.button || 'Use this' },
      multiple: false,
      library: opts.libraryType && opts.libraryType !== 'any' ? { type: opts.libraryType } : undefined,
    }) as WpMediaFrame;

    frame.on('select', () => {
      const sel = frame.state().get('selection');
      const att = sel.first?.()?.toJSON?.();
      if (!att) return resolve(null);
      resolve({
        id: Number(att.id || 0),
        url: String(att.url || ''),
        alt: String(att.alt || ''),
        title: String(att.title || ''),
        mime: String(att.mime || ''),
      });
    });

    frame.on('close', () => resolve(null));
    frame.open();
  });
}

