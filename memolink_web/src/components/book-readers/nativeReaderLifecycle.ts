import { Capacitor } from "@capacitor/core";

// Android WebView may blank its composited surface when a large canvas or iframe
// is removed in the same paint that reveals the next screen.
const NATIVE_READER_SETTLE_DELAY_MS = 750;

export function isNativeReaderPlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export function disposeReaderAfterPaint(dispose: () => void): void {
  if (isNativeReaderPlatform()) window.setTimeout(dispose, NATIVE_READER_SETTLE_DELAY_MS);
  else dispose();
}
