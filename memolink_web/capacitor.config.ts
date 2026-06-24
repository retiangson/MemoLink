import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.memolink.app',
  appName: 'MemoLink',
  webDir: 'dist',
  // Routes fetch/XHR through native Android networking instead of the WebView's
  // own network stack, so direct cross-origin downloads (e.g. presigned OneDrive
  // book URLs) aren't subject to browser CORS the way they are inside a WebView.
  plugins: {
    CapacitorHttp: {
      enabled: true
    }
  }
};

export default config;
