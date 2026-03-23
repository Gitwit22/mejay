// Web Worker for reliable background timing.
// Browser tabs throttle setInterval/setTimeout when not visible (1s+ on desktop,
// potentially fully suspended on mobile). Web Workers are NOT throttled, so we
// use one to send periodic tick messages back to the main thread.

const TICK_INTERVAL_MS = 200;

let intervalId: ReturnType<typeof setInterval> | null = null;

self.onmessage = (e: MessageEvent<{ command: 'start' | 'stop' }>) => {
  if (e.data.command === 'start') {
    if (intervalId !== null) return;
    intervalId = setInterval(() => {
      self.postMessage({ type: 'tick' });
    }, TICK_INTERVAL_MS);
  } else if (e.data.command === 'stop') {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
};
