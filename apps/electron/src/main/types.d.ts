// electron-vite exposes MAIN_VITE_-prefixed env vars on import.meta.env in the
// main process. Merge our keys into vite/client's ImportMetaEnv.
interface ImportMetaEnv {
  readonly MAIN_VITE_KEEP_DOWNLOADS?: string;
}
