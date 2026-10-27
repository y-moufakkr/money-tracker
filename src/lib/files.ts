import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Writes `content` to the cache and opens the system share sheet (save to Files, Drive, email…). */
export async function shareFile(name: string, content: string | Uint8Array, mimeType: string): Promise<void> {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
}

/** Lets the user pick a file and returns its bytes, or null when cancelled. */
export async function pickFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['*/*'] });
  if (picked.canceled) return null;
  return { name: picked.result.name, bytes: await picked.result.bytes() };
}
