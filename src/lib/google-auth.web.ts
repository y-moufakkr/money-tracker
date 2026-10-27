import type { GoogleAccount } from './google-auth';

/** Google Sign-In uses the Android Play services SDK; the web build (smoke tests only) has none. */

export const GOOGLE_WEB_CLIENT_ID = '';
export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export const googleSignInSupported = false;

const unsupported = () => Promise.reject(new Error('Google Sign-In is only available in the Android app.'));

export async function restoreGoogleSession(): Promise<GoogleAccount | null> {
  return null;
}
export const signInWithGoogle = unsupported;
export const signOutOfGoogle = async () => undefined;
export const googleTokens = { get: unsupported, refresh: unsupported };
