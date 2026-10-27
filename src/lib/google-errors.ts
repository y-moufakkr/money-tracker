/**
 * User-facing messages for Google Sign-In and Drive failures. The Android library rejects with
 * Google Play services status codes as strings ("10" = DEVELOPER_ERROR, "7" = NETWORK_ERROR).
 */
export function authErrorMessage(e: unknown): string {
  const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : null;
  const message = e instanceof Error ? e.message : typeof e === 'object' && e !== null && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  switch (code) {
    case '10':
      return 'Google refused this build of the app (DEVELOPER_ERROR). It is not signed with the key registered for Money Tracker (SHA-1 in docs/google-oauth.md). Install the EAS build, or register this signing key in the Google Cloud project.';
    case '7':
      return 'No connection to Google. Check your internet connection and try again. Your data on this phone is not affected.';
    case 'PLAY_SERVICES_NOT_AVAILABLE':
      return 'Google Play services are missing or out of date on this device. Update them from the Play Store, then try again.';
    case 'IN_PROGRESS':
      return 'Google sign-in is already in progress.';
    case 'SIGN_IN_REQUIRED':
    case '4':
      return 'Your Google session has expired. Sign in again.';
    case '12500':
      return 'Google sign-in failed. Check that a Google account is set up on this device, then try again.';
    default:
      return message || 'Something went wrong with Google.';
  }
}
