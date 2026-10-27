/** Web build (smoke tests only): downloads instead of the share sheet, and a file input to pick. */

export async function shareFile(name: string, content: string | Uint8Array, mimeType: string): Promise<void> {
  const blob = new Blob([content as BlobPart], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function pickFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      f.arrayBuffer().then((b) => resolve({ name: f.name, bytes: new Uint8Array(b) }), reject);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
