import {
  GoogleSignin,
  isCancelledResponse,
  isNoSavedCredentialFoundResponse,
  isSuccessResponse,
  type User,
} from '@react-native-google-signin/google-signin';

/**
 * Google Sign-In on Android (no backend, no client secret, no Firebase). Tokens are kept by Google
 * Play services and fetched on demand; the app never stores them. Setup: docs/google-oauth.md.
 */

export const GOOGLE_WEB_CLIENT_ID = '563625916244-m4puampq7t01qacdbb1nrv3i0dmb3oht.apps.googleusercontent.com';
export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

export const googleSignInSupported = true;

export type GoogleAccount = { id: string; email: string; name: string | null; photo: string | null; hasDriveScope: boolean };

let configured = false;
function configure() {
  if (configured) return;
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID, scopes: [DRIVE_APPDATA_SCOPE], offlineAccess: false });
  configured = true;
}

const toAccount = (u: User): GoogleAccount => ({
  id: u.user.id,
  email: u.user.email,
  name: u.user.name,
  photo: u.user.photo,
  hasDriveScope: u.scopes.includes(DRIVE_APPDATA_SCOPE),
});

/** The signed-in account from a previous session, if any (no UI). */
export async function restoreGoogleSession(): Promise<GoogleAccount | null> {
  configure();
  const current = GoogleSignin.getCurrentUser();
  if (current) return toAccount(current);
  if (!GoogleSignin.hasPreviousSignIn()) return null;
  const r = await GoogleSignin.signInSilently();
  if (isNoSavedCredentialFoundResponse(r)) return null;
  return toAccount(r.data);
}

/** Opens Google's account picker. Null when the user cancels. */
export async function signInWithGoogle(): Promise<GoogleAccount | null> {
  configure();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const r = await GoogleSignin.signIn();
  if (isCancelledResponse(r) || !isSuccessResponse(r)) return null;
  let account = toAccount(r.data);
  if (!account.hasDriveScope) {
    const granted = await GoogleSignin.addScopes({ scopes: [DRIVE_APPDATA_SCOPE] });
    if (granted && isSuccessResponse(granted)) account = toAccount(granted.data);
  }
  return account;
}

export async function signOutOfGoogle(): Promise<void> {
  configure();
  await GoogleSignin.signOut();
}

/** Token source for the Drive client. */
export const googleTokens = {
  get: async () => {
    configure();
    return (await GoogleSignin.getTokens()).accessToken;
  },
  refresh: async (rejected: string) => {
    await GoogleSignin.clearCachedAccessToken(rejected);
    return (await GoogleSignin.getTokens()).accessToken;
  },
};
