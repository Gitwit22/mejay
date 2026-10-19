import {spawn} from 'node:child_process'

/**
 * Binary paths. The converter service installs static builds (`npm run install:converter-tools`) so the
 * host needs nothing preinstalled; anywhere else (e.g. a dev machine) we fall back to ffmpeg on PATH.
 * Resolved lazily so importing this module never requires the packages.
 */
function optionalModule<T>(name: string): T | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(name) as T
  } catch {
    return null
  }
}

let resolved: {ffmpeg: string; ffprobe: string} | null = null
export function audioToolPaths(): {ffmpeg: string; ffprobe: string} {
  if (!resolved) {
    const ffmpeg = optionalModule<string | {default: string}>('ffmpeg-static')
    const ffprobe = optionalModule<{path: string}>('@ffprobe-installer/ffprobe')
    resolved = {
      ffmpeg: (typeof ffmpeg === 'string' ? ffmpeg : ffmpeg?.default) || 'ffmpeg',
      ffprobe: ffprobe?.path || 'ffprobe',
    }
  }
  return resolved
}

export class AudioToolError extends Error {
  constructor(message: string, readonly stderr: string = '') {
    super(message)
    this.name = 'AudioToolError'
  }
}

export type RunResult = {stdout: string; stderr: string}

/**
 * Runs a binary with an argument list (never a shell string) and a hard timeout. Output is capped so
 * a misbehaving decoder cannot exhaust memory on a small instance.
 */
export function runTool(binary: string, args: string[], {timeoutMs = 10 * 60_000, maxOutputBytes = 4 * 1024 * 1024} = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {stdio: ['ignore', 'pipe', 'pipe']})
    let stdout = ''
    let stderr = ''
    const append = (current: string, chunk: Buffer) => (current.length >= maxOutputBytes ? current : current + chunk.toString('utf8'))
    child.stdout.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk) })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new AudioToolError(`${binary.split('/').pop()} timed out after ${Math.round(timeoutMs / 1000)}s`, stderr))
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new AudioToolError(`Could not start ${binary.split('/').pop()}: ${error.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve({stdout, stderr})
      else reject(new AudioToolError(`${binary.split('/').pop()} exited with code ${code}`, stderr))
    })
  })
}

export const runFfmpeg = (args: string[], options?: Parameters<typeof runTool>[2]) => runTool(audioToolPaths().ffmpeg, ['-hide_banner', '-nostdin', '-y', ...args], options)
export const runFfprobe = (args: string[], options?: Parameters<typeof runTool>[2]) => runTool(audioToolPaths().ffprobe, ['-hide_banner', ...args], options)

/** Last few stderr lines, trimmed, for job error messages (never file contents). */
export function summarizeToolError(error: unknown): string {
  if (error instanceof AudioToolError) {
    const tail = error.stderr.trim().split('\n').slice(-3).join(' | ')
    return `${error.message}${tail ? `: ${tail}` : ''}`.slice(0, 900)
  }
  return (error instanceof Error ? error.message : 'Unknown error').slice(0, 900)
}
