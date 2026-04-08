/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_MIGRA_ENV: string;
  readonly VITE_MIGRA_API_BASE_URL: string;
  readonly VITE_MIGRA_VOIP_DOMAIN: string;
  readonly VITE_MIGRA_VOIP_PROXY: string;
  readonly VITE_MIGRA_VOIP_WSS_URL: string;
  readonly VITE_MIGRA_VOIP_STUN_SERVERS: string;
  readonly VITE_MIGRA_FEATURE_VOICEMAIL: string;
  readonly VITE_MIGRA_FEATURE_CONTACTS_SYNC: string;
  readonly VITE_MIGRA_FEATURE_WEB_PUSH: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;
