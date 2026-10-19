// The converter's binaries are installed only on the converter service (`npm run install:converter-tools`),
// never on the API, so these modules are optional at runtime and resolved lazily in src/audio/ffmpeg.ts.
declare module 'ffmpeg-static' {
  const ffmpegPath: string | null
  export default ffmpegPath
}

declare module '@ffprobe-installer/ffprobe' {
  const ffprobe: {path: string; version: string}
  export default ffprobe
}
