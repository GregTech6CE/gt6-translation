/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

declare module 'virtual:gt6tg-kb-corpus' {
  export interface KbCorpusSnapshot {
    readonly gt6: Record<string, string>;
    readonly gt6ce: Record<string, string>;
    readonly gt6Available: boolean;
    readonly gt6ceAvailable: boolean;
    readonly gt6Source: string | null;
    readonly gt6ceSource: string | null;
  }
  const snapshot: KbCorpusSnapshot;
  export default snapshot;
}
