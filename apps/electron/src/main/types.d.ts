// ffprobe-static ships JS without types. We only use its default-exported
// `.path` string, so a minimal declaration is enough.
declare module 'ffprobe-static' {
  const m: { path: string };
  export default m;
}

// electron-vite exposes MAIN_VITE_-prefixed env vars on import.meta.env in the
// main process. Merge our keys into vite/client's ImportMetaEnv.
interface ImportMetaEnv {
  readonly MAIN_VITE_KEEP_DOWNLOADS?: string;
}
