import { createDriveStore, DriveError, multipartBody, type FetchLike, type FetchResponse } from './drive-api';

type Call = { url: string; method: string; headers: Record<string, string>; body?: Uint8Array | string };

const json = (status: number, body: unknown): FetchResponse => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
  arrayBuffer: async () => new ArrayBuffer(0),
});

function setup(responses: (FetchResponse | Error)[]) {
  const calls: Call[] = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, ...init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    if (next instanceof Error) throw next;
    return next;
  };
  const refreshed: string[] = [];
  const store = createDriveStore(fetchFn, {
    get: async () => 'token-1',
    refresh: async (stale) => {
      refreshed.push(stale);
      return 'token-2';
    },
  });
  return { store, calls, refreshed };
}

describe('Drive appDataFolder client', () => {
  it('lists only the app folder, following pages', async () => {
    const { store, calls } = setup([
      json(200, { files: [{ id: 'a', name: 'a.db' }], nextPageToken: 'p2' }),
      json(200, { files: [{ id: 'b', name: 'b.db' }] }),
    ]);
    expect((await store.list()).map((f) => f.id)).toEqual(['a', 'b']);
    expect(calls[0].url).toContain('spaces=appDataFolder');
    expect(calls[0].headers.Authorization).toBe('Bearer token-1');
    expect(calls[1].url).toContain('pageToken=p2');
  });

  it('uploads into appDataFolder with metadata and checks the stored size', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const { store, calls } = setup([json(200, { id: 'f1', name: 'x.db', size: '4' }), json(200, { id: 'f2', name: 'x.db', size: '3' })]);
    const upload = { name: 'x.db', bytes, appProperties: { sha256: 'abc' }, description: '{}' };
    expect((await store.upload(upload)).id).toBe('f1');
    const body = new TextDecoder().decode(calls[0].body as Uint8Array);
    expect(calls[0].url).toContain('uploadType=multipart');
    expect(body).toContain('"parents":["appDataFolder"]');
    expect(body).toContain('"appProperties":{"sha256":"abc"}');
    await expect(store.upload(upload)).rejects.toThrow(/3 bytes instead of 4/);
  });

  it('builds a multipart body that carries the bytes unchanged', () => {
    const bytes = new Uint8Array([0, 255, 13, 10, 45, 45]);
    const body = multipartBody({ name: 'x' }, bytes, 'B');
    const text = new TextDecoder('latin1').decode(body);
    expect(text.startsWith('--B\r\nContent-Type: application/json')).toBe(true);
    expect(text.endsWith('\r\n--B--\r\n')).toBe(true);
    const start = text.indexOf('application/octet-stream\r\n\r\n') + 'application/octet-stream\r\n\r\n'.length;
    expect([...body.slice(start, start + bytes.length)]).toEqual([...bytes]);
  });

  it('refreshes an expired token once and retries', async () => {
    const { store, calls, refreshed } = setup([json(401, {}), json(204, {})]);
    await store.remove('f1');
    expect(refreshed).toEqual(['token-1']);
    expect(calls[1].headers.Authorization).toBe('Bearer token-2');
    expect(calls[1].method).toBe('DELETE');
  });

  it('turns failures into clear errors', async () => {
    await expect(setup([new TypeError('Network request failed')]).store.list()).rejects.toMatchObject({ code: 'offline' });
    await expect(setup([json(401, {}), json(401, {})]).store.list()).rejects.toMatchObject({ code: 'auth' });
    await expect(setup([json(404, {})]).store.download('gone')).rejects.toMatchObject({ code: 'not-found' });
    await expect(
      setup([json(403, { error: { message: 'quota', errors: [{ reason: 'storageQuotaExceeded' }] } })]).store.list(),
    ).rejects.toMatchObject({ code: 'quota' });
    await expect(
      setup([json(403, { error: { message: 'Insufficient Permission', errors: [{ reason: 'insufficientPermissions' }] } })]).store.list(),
    ).rejects.toBeInstanceOf(DriveError);
  });
});
