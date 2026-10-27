import { router } from 'expo-router';

/** Closes a modal/screen, falling back to Home when it was opened directly (deep link, restored state). */
export function closeScreen() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
