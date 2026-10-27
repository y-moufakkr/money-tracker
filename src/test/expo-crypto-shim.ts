import { createHash, randomUUID as nodeRandomUUID } from 'node:crypto';

export function randomUUID(): string {
  return nodeRandomUUID();
}

export enum CryptoDigestAlgorithm {
  SHA256 = 'SHA-256',
}

export async function digest(algorithm: CryptoDigestAlgorithm, data: ArrayBufferView): Promise<ArrayBuffer> {
  if (algorithm !== CryptoDigestAlgorithm.SHA256) throw new Error(`Unsupported algorithm ${algorithm}`);
  const out = createHash('sha256').update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)).digest();
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}
