import { APP_CONFIG } from '@/constants/config';

let lastActivityTimestamp = Date.now();
let sessionTimeoutCallback: (() => void) | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;

export function registerActivity() {
  lastActivityTimestamp = Date.now();
}

export function startSessionMonitor(onTimeout: () => void) {
  sessionTimeoutCallback = onTimeout;
  intervalId = setInterval(() => {
    const elapsed = Date.now() - lastActivityTimestamp;
    const timeoutMs = APP_CONFIG.sessionTimeoutMinutes * 60 * 1000;
    if (elapsed >= timeoutMs && sessionTimeoutCallback) {
      sessionTimeoutCallback();
    }
  }, 30000); // check every 30 seconds
}

export function stopSessionMonitor() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  sessionTimeoutCallback = null;
}
