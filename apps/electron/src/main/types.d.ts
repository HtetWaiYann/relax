// ffprobe-static ships JS without types. We only use its default-exported
// `.path` string, so a minimal declaration is enough.
declare module 'ffprobe-static' {
  const m: { path: string };
  export default m;
}
