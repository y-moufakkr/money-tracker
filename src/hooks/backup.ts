import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetch } from 'expo/fetch';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';
import { create } from 'zustand';

import { APP_VERSION, deviceName } from '@/lib/app-info';
import { expoBackupEngine } from '@/lib/backup-engine';
import { authErrorMessage } from '@/lib/google-errors';
import {
  googleSignInSupported,
  googleTokens,
  restoreGoogleSession,
  signInWithGoogle,
  signOutOfGoogle,
  type GoogleAccount,
} from '@/lib/google-auth';
import {
  backupStatus,
  backupToDrive,
  createSnapshot,
  deleteRemoteBackup,
  listRemoteBackups,
  restoreFromBytes,
  restoreFromDrive,
  setKeepBackups,
  undoRestore,
  verifyRemoteBackup,
  type RemoteBackup,
} from '@/services/backup';
import { createDriveStore } from '@/services/drive-api';
import { exportEntries, type ExportFilter } from '@/services/export';
import { useDb } from './data';

// ---------------------------------------------------------------------------
// Google account (shared by Settings and the backup screens)

type AuthState = {
  status: 'unknown' | 'signed-out' | 'signed-in' | 'unsupported';
  account: GoogleAccount | null;
  busy: boolean;
  error: string | null;
};

const useAuthStore = create<AuthState>(() => ({
  status: googleSignInSupported ? 'unknown' : 'unsupported',
  account: null,
  busy: false,
  error: null,
}));

let restoring = false;

export function useGoogleAccount() {
  const state = useAuthStore();
  useEffect(() => {
    if (!googleSignInSupported || restoring || useAuthStore.getState().status !== 'unknown') return;
    restoring = true;
    restoreGoogleSession()
      .then((account) => useAuthStore.setState({ status: account ? 'signed-in' : 'signed-out', account, error: null }))
      // Offline at startup: stay usable and let the user sign in again later.
      .catch((e) => useAuthStore.setState({ status: 'signed-out', account: null, error: authErrorMessage(e) }))
      .finally(() => {
        restoring = false;
      });
  }, []);

  const qc = useQueryClient();
  return {
    ...state,
    signIn: async () => {
      useAuthStore.setState({ busy: true, error: null });
      try {
        const account = await signInWithGoogle();
        // A cancelled picker leaves things as they were, without an error.
        if (account) useAuthStore.setState({ status: 'signed-in', account });
      } catch (e) {
        useAuthStore.setState({ error: authErrorMessage(e) });
      } finally {
        useAuthStore.setState({ busy: false });
      }
    },
    signOut: async () => {
      useAuthStore.setState({ busy: true, error: null });
      try {
        await signOutOfGoogle();
        useAuthStore.setState({ status: 'signed-out', account: null });
        qc.removeQueries({ queryKey: [DRIVE] });
      } catch (e) {
        useAuthStore.setState({ error: authErrorMessage(e) });
      } finally {
        useAuthStore.setState({ busy: false });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Backup engine, Drive and queries

const DRIVE = 'drive';
// expo/fetch sends Uint8Array bodies as raw bytes on Android.
const drive = createDriveStore((url, init) => fetch(url, { ...init, body: init.body as BodyInit | undefined }), googleTokens);

function useEngine() {
  const sqlite = useSQLiteContext();
  const db = useDb();
  return expoBackupEngine(sqlite, db);
}

export function useBackupStatus() {
  const db = useDb();
  // Under 'ledger' so every write refreshes "changes since the last backup".
  return useQuery({ queryKey: ['ledger', 'backup-status'], queryFn: () => backupStatus(db) });
}

export function useRemoteBackups() {
  const email = useAuthStore((s) => s.account?.email ?? null);
  return useQuery({
    queryKey: [DRIVE, 'backups', email],
    queryFn: () => listRemoteBackups(drive),
    enabled: !!email,
  });
}

export function useExportPreview(filter: ExportFilter) {
  const db = useDb();
  return useQuery({ queryKey: ['ledger', 'export', filter], queryFn: () => exportEntries(db, filter), placeholderData: (prev) => prev });
}

/** Photos missing on this phone can be fetched from Drive when signed in. */
const photoSource = () => (useAuthStore.getState().status === 'signed-in' ? drive : null);

const ctx = () => ({ appVersion: APP_VERSION, deviceName: deviceName(), accountEmail: useAuthStore.getState().account?.email ?? null });

/** Backup actions. A restore refreshes every query, since all data changed at once. */
export function useBackupActions() {
  const engine = useEngine();
  const qc = useQueryClient();
  const db = engine.live;
  const refreshAll = () => qc.invalidateQueries();
  const refreshDrive = () => qc.invalidateQueries({ queryKey: [DRIVE] });

  return {
    backUp: useMutation({
      mutationFn: () => backupToDrive(engine, drive, ctx()),
      onSettled: () => Promise.all([refreshDrive(), qc.invalidateQueries({ queryKey: ['ledger', 'backup-status'] })]),
    }),
    verify: useMutation({ mutationFn: (remote: RemoteBackup) => verifyRemoteBackup(engine, drive, remote) }),
    remove: useMutation({ mutationFn: (fileId: string) => deleteRemoteBackup(db, drive, fileId), onSettled: refreshDrive }),
    restoreRemote: useMutation({
      mutationFn: (v: { remote: RemoteBackup; allowMissingPhotos?: boolean }) =>
        restoreFromDrive(engine, drive, v.remote, { allowMissingPhotos: v.allowMissingPhotos }),
      onSettled: refreshAll,
    }),
    restoreFile: useMutation({
      mutationFn: (v: { file: { name: string; bytes: Uint8Array }; allowMissingPhotos?: boolean }) =>
        restoreFromBytes(engine, v.file.bytes, { kind: 'file', label: v.file.name }, undefined, {
          drive: photoSource(),
          allowMissingPhotos: v.allowMissingPhotos,
        }),
      onSettled: refreshAll,
    }),
    undo: useMutation({
      mutationFn: (v: { allowMissingPhotos?: boolean }) => undoRestore(engine, { drive: photoSource(), allowMissingPhotos: v.allowMissingPhotos }),
      onSettled: refreshAll,
    }),
    snapshot: useMutation({ mutationFn: () => createSnapshot(engine, ctx()) }),
    setKeep: useMutation({
      mutationFn: (keep: number) => setKeepBackups(db, keep),
      onSuccess: () => qc.invalidateQueries({ queryKey: ['ledger', 'backup-status'] }),
    }),
  };
}
