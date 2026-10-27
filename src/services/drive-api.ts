import type { DriveFile, DriveStore, DriveUpload } from './backup';

/**
 * Google Drive v3 REST, limited to the `appDataFolder` (scope `drive.appdata`): a private folder
 * only this app can see. No backend, API key or client secret: the access token comes from
 * Google Sign-In on the device. `fetch` and the token source are injected so this is testable.
 */

export type FetchResponse = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
};

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: Uint8Array | string },
) => Promise<FetchResponse>;

export type TokenSource = {
  get(): Promise<string>;
  /** Drops a token Google rejected and returns a fresh one. */
  refresh(rejected: string): Promise<string>;
};

export type DriveErrorCode = 'offline' | 'auth' | 'permission' | 'quota' | 'not-found' | 'http';

export class DriveError extends Error {
  constructor(
    readonly code: DriveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILE_FIELDS = 'id,name,size,createdTime,description,appProperties';

/** multipart/related body: JSON metadata, then the file bytes. */
export function multipartBody(metadata: object, bytes: Uint8Array, boundary: string): Uint8Array {
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const out = new Uint8Array(head.length + bytes.length + tail.length);
  out.set(head, 0);
  out.set(bytes, head.length);
  out.set(tail, head.length + bytes.length);
  return out;
}

async function errorFor(res: FetchResponse): Promise<DriveError> {
  let reason = '';
  let message = '';
  try {
    const body = JSON.parse(await res.text()) as { error?: { message?: string; errors?: { reason?: string }[] } };
    reason = body.error?.errors?.[0]?.reason ?? '';
    message = body.error?.message ?? '';
  } catch {
    // Not JSON: keep the status only.
  }
  if (res.status === 401) return new DriveError('auth', 'Google did not accept the sign-in. Sign out and sign in again.');
  if (res.status === 404) return new DriveError('not-found', 'This backup no longer exists on Google Drive.');
  if (reason === 'storageQuotaExceeded') return new DriveError('quota', 'Your Google Drive is full. Free some space, then back up again.');
  if (res.status === 403 && /insufficient|scope|permission/i.test(reason + message)) {
    return new DriveError('permission', 'Money Tracker is not allowed to use its Google Drive folder. Sign out, sign in again and allow access.');
  }
  return new DriveError('http', `Google Drive error ${res.status}${message ? `: ${message}` : ''}`);
}

export function createDriveStore(fetchFn: FetchLike, tokens: TokenSource): DriveStore {
  async function request(url: string, init: { method: string; headers?: Record<string, string>; body?: Uint8Array | string }) {
    const send = async (token: string) => {
      try {
        return await fetchFn(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
      } catch {
        throw new DriveError('offline', 'No connection to Google Drive. Check your internet connection and try again.');
      }
    };
    const token = await tokens.get();
    let res = await send(token);
    if (res.status === 401) res = await send(await tokens.refresh(token));
    if (!res.ok) throw await errorFor(res);
    return res;
  }

  return {
    async list() {
      const files: DriveFile[] = [];
      let pageToken: string | undefined;
      do {
        const q = new URLSearchParams({
          spaces: 'appDataFolder',
          pageSize: '100',
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          ...(pageToken ? { pageToken } : {}),
        });
        const res = await request(`${API}/files?${q.toString()}`, { method: 'GET' });
        const page = JSON.parse(await res.text()) as { files?: DriveFile[]; nextPageToken?: string };
        files.push(...(page.files ?? []));
        pageToken = page.nextPageToken;
      } while (pageToken);
      return files;
    },

    async upload(u: DriveUpload) {
      const boundary = `money-tracker-${Date.now().toString(36)}`;
      const metadata = {
        name: u.name,
        parents: ['appDataFolder'],
        mimeType: u.mimeType ?? 'application/vnd.sqlite3',
        appProperties: u.appProperties,
        description: u.description,
      };
      const res = await request(`${UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: multipartBody(metadata, u.bytes, boundary),
      });
      const file = JSON.parse(await res.text()) as DriveFile;
      if (Number(file.size) !== u.bytes.length) {
        throw new DriveError('http', `Google Drive stored ${file.size} bytes instead of ${u.bytes.length}.`);
      }
      return file;
    },

    async download(fileId: string) {
      const res = await request(`${API}/files/${encodeURIComponent(fileId)}?alt=media`, { method: 'GET' });
      return new Uint8Array(await res.arrayBuffer());
    },

    async remove(fileId: string) {
      await request(`${API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
    },
  };
}
