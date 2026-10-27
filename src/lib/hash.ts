import { CryptoDigestAlgorithm, digest } from 'expo-crypto';

/** SHA-256 of `bytes` as 64 lowercase hex characters. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes as Uint8Array<ArrayBuffer>));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}
