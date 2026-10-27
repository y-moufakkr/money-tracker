import { router } from 'expo-router';
import { View } from 'react-native';

import { formatTimestamp } from '@/domain/dates';
import { useBackupActions, useBackupStatus, useGoogleAccount, useRemoteBackups } from '@/hooks/backup';
import { chooseAction, confirmAction, notify } from '@/lib/confirm';
import { assessBackup, assessRestore, localState, type BackupManifest, type RestoreResult } from '@/services/backup';
import { Banner, Button, Card, Divider, ListItem, Row, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** "120 transactions · 5 locations" from a backup's row counts. */
export function countsLabel(counts: Record<string, number>): string {
  const parts: string[] = [];
  const add = (table: string, one: string, many: string) => {
    const n = counts[table];
    if (n !== undefined) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add('transactions', 'transaction', 'transactions');
  add('accounts', 'location', 'locations');
  add('companies', 'company', 'companies');
  return parts.join(' · ');
}

/** A subtitle that wraps (ListItem truncates string subtitles to one line). */
function Sub({ children }: { children: string }) {
  return (
    <Text variant="caption" tone="muted">
      {children}
    </Text>
  );
}

export function NotSyncNote() {
  return (
    <Banner tone="info" icon="info" title="Backup, not sync">
      A backup is a full copy of your data at one moment, kept in Money Tracker’s private folder on your Google Drive. Nothing syncs
      automatically and nothing is merged: restoring replaces all data on this phone with the backup (a recovery copy is kept so you
      can undo).
    </Banner>
  );
}

export function GoogleAccountRow() {
  const c = useColors();
  const auth = useGoogleAccount();
  if (auth.status === 'unsupported') {
    return (
      <ListItem
        icon="account_circle"
        iconColor={c.textMuted}
        title="Google account"
        subtitle={<Sub>Sign-in and Drive backup work in the Android app only. Export and local backup files work here.</Sub>}
      />
    );
  }
  const account = auth.account;
  return (
    <View>
      {account ? (
        <ListItem
          icon="account_circle"
          iconColor={c.primary}
          title={account.email}
          subtitle={<Sub>{account.hasDriveScope ? 'Signed in · private app folder on Google Drive' : 'Signed in · Drive access not granted'}</Sub>}
          right={<Button compact kind="ghost" label="Sign out" loading={auth.busy} onPress={() => auth.signOut()} />}
        />
      ) : (
        <ListItem
          icon="account_circle"
          iconColor={c.textMuted}
          title={auth.status === 'unknown' ? 'Checking Google account…' : 'Not signed in'}
          subtitle={<Sub>Only Money Tracker’s own Drive folder is used (drive.appdata). Your other Drive files are never visible to the app.</Sub>}
          right={
            auth.status === 'signed-out' ? (
              <Button compact label="Sign in" icon="login" loading={auth.busy} onPress={() => auth.signIn()} />
            ) : undefined
          }
        />
      )}
      {auth.error && (
        <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
          <Banner tone="danger" title="Google sign-in">
            {auth.error}
          </Banner>
        </View>
      )}
    </View>
  );
}

/** Back up now, with a warning when another device made a newer backup or this phone is empty. */
export function useBackUpNow() {
  const status = useBackupStatus().data;
  const remotes = useRemoteBackups().data ?? [];
  const actions = useBackupActions();
  const run = () =>
    actions.backUp.mutate(undefined, {
      onSuccess: (r) =>
        notify(
          'Backup complete',
          `Uploaded and verified: the copy on Google Drive was downloaded again and its SHA-256 matches.${
            r.photos.uploaded ? ` ${r.photos.uploaded} receipt photo${r.photos.uploaded > 1 ? 's' : ''} uploaded and verified.` : ''
          }${
            r.deleted.length ? ` ${r.deleted.length} older backup${r.deleted.length > 1 ? 's' : ''} from this phone removed.` : ''
          }${
            r.photos.missing
              ? `\n\n${r.photos.missing} receipt photo${r.photos.missing > 1 ? 's are' : ' is'} missing or damaged on this phone and could not be backed up.`
              : ''
          }${r.retentionError ? `\n\nOlder backups could not be cleaned up (${r.retentionError}). They will be retried next time.` : ''}`,
        ),
      onError: (e) => notify('Backup failed', `${e.message}\n\nNothing on this phone was changed.`),
    });
  const start = () => {
    const warnings = status ? assessBackup(localState(status), remotes) : [];
    if (warnings.length) confirmAction('Back up anyway?', warnings.map((w) => w.message).join('\n\n'), 'Back up', run);
    else run();
  };
  return { start, pending: actions.backUp.isPending };
}

export function restoredMessage(r: RestoreResult): string {
  const migrated = r.fromSchema < r.schemaVersion ? ` It was upgraded from data format v${r.fromSchema} to v${r.schemaVersion}.` : '';
  const photos =
    r.photos.fetched || r.photos.missing
      ? `\n\nReceipt photos: ${r.photos.fetched} downloaded from Google Drive and verified${r.photos.missing ? `, ${r.photos.missing} left out (missing or damaged)` : ''}.`
      : '';
  return `${countsLabel(r.rowCounts)}.${migrated}${photos}\n\nYour previous data is kept as a recovery copy: “Undo restore” in Backups & restore puts it back.`;
}

/**
 * Asks before replacing this phone's data. When the phone has changes that are in no backup, the
 * user must choose explicitly: back up first, or replace them.
 */
export function useConfirmRestore() {
  const status = useBackupStatus().data;
  const auth = useGoogleAccount();
  const backUp = useBackUpNow();
  return (target: BackupManifest | null, label: string, run: () => void) => {
    if (!status) return;
    const a = assessRestore(localState(status), target);
    const message = [
      ...a.warnings.map((w) => w.message),
      `Restoring replaces ALL data on this phone with ${label}. Nothing is merged. A recovery copy of the current data is kept on this phone.`,
    ].join('\n\n');
    if (a.requiresChoice) {
      chooseAction('Unsaved changes on this phone', message, [
        ...(auth.account ? [{ label: 'Back up this phone first', onPress: backUp.start }] : []),
        { label: 'Replace this phone’s data', onPress: run, destructive: true },
      ]);
    } else {
      confirmAction('Restore this backup?', message, 'Restore', run, true);
    }
  };
}

/** Settings section: account, last backup, Back up now and links. */
export function BackupSection() {
  const c = useColors();
  const auth = useGoogleAccount();
  const status = useBackupStatus().data;
  const backUp = useBackUpNow();
  const last = status?.lastBackup ?? null;
  const meta = status?.meta;

  return (
    <View style={{ gap: space.sm }}>
      <NotSyncNote />
      <Card padded={false}>
        <GoogleAccountRow />
        <Divider inset={68} />
        <ListItem
          icon={status?.unbackedChanges ? 'cloud_off' : 'cloud_done'}
          iconColor={status?.unbackedChanges ? c.warning : c.primary}
          title={last ? `Last backup ${formatTimestamp(last.createdAt)}` : 'Never backed up to Google Drive'}
          subtitle={
            !status ? undefined : (
              <Sub>
                {status.unbackedChanges
                ? status.hasData
                  ? 'This phone has changes that are not in any backup.'
                  : 'No data yet.'
                : last
                  ? `Up to date · ${formatBytes(last.size)}${last.accountEmail ? ` · ${last.accountEmail}` : ''}`
                  : 'Your data matches the backup it was restored from.'}
              </Sub>
            )
          }
        />
        {auth.status === 'signed-in' && (
          <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}>
            <Button label="Back up now" icon="backup" loading={backUp.pending} onPress={backUp.start} />
          </View>
        )}
        <Divider inset={68} />
        <ListItem
          icon="history"
          iconColor={c.primary}
          title="Backups & restore"
          subtitle={
            <Sub>
              {meta?.recoveryAt ? `History, integrity checks, restore · recovery copy from ${formatTimestamp(meta.recoveryAt)}` : 'History, integrity checks, restore'}
            </Sub>
          }
          chevron
          onPress={() => router.push('/backup')}
        />
        <Divider inset={68} />
        <ListItem
          icon="ios_share"
          iconColor={c.primary}
          title="Export data"
          subtitle={<Sub>CSV or JSON, or a full backup file — no Google account needed</Sub>}
          chevron
          onPress={() => router.push('/backup/export')}
        />
      </Card>
      {status?.unbackedChanges && status.hasData && !last && (
        <Text variant="caption" tone="faint">
          Until you back up, your data lives only on this phone: uninstalling the app or clearing its storage deletes it.
        </Text>
      )}
      {meta && (
        <Row style={{ justifyContent: 'flex-end' }}>
          <Text variant="caption" tone="faint">
            Device {meta.deviceId.slice(0, 8)}
          </Text>
        </Row>
      )}
    </View>
  );
}
