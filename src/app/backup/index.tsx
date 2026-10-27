import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { countsLabel, formatBytes, GoogleAccountRow, NotSyncNote, restoredMessage, useBackUpNow, useConfirmRestore } from '@/components/backup';
import { formatTimestamp } from '@/domain/dates';
import { useBackupActions, useBackupStatus, useGoogleAccount, useRemoteBackups } from '@/hooks/backup';
import { confirmAction, notify } from '@/lib/confirm';
import { pickFile } from '@/lib/files';
import { isSqliteFile, KEEP_BACKUP_CHOICES, type RemoteBackup, type VerifyResult } from '@/services/backup';
import { ChipGroup } from '@/ui/fields';
import { Banner, Button, Card, Chip, Divider, Loading, Row, SectionHeader, Text } from '@/ui/primitives';
import { space, useColors } from '@/ui/theme';

function BackupCard({
  remote,
  mine,
  current,
  check,
  busy,
  onVerify,
  onRestore,
  onDelete,
}: {
  remote: RemoteBackup;
  mine: boolean;
  current: boolean;
  check: VerifyResult | undefined;
  busy: boolean;
  onVerify: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const c = useColors();
  const m = remote.manifest;
  return (
    <Card style={{ gap: space.xs, marginBottom: space.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="bodyStrong">{m ? formatTimestamp(m.createdAt) : remote.name}</Text>
        {current && (
          <Text variant="caption" color={c.primary}>
            Matches this phone
          </Text>
        )}
      </Row>
      {m ? (
        <>
          <Text variant="label" tone="muted">
            {m.deviceName ?? 'Unknown device'}
            {mine ? ' (this phone)' : ''} · {formatBytes(m.size)} · data v{m.schemaVersion} · app {m.appVersion}
          </Text>
          <Text variant="caption" tone="faint">
            {countsLabel(m.rowCounts)}
          </Text>
        </>
      ) : (
        <Text variant="label" tone="muted">
          Not a Money Tracker backup (no backup information). It is never restored or deleted automatically.
        </Text>
      )}
      {check &&
        (check.ok ? (
          <Text variant="caption" color={c.positive}>
            ✓ Intact: size, SHA-256 and SQLite integrity check pass ({countsLabel(check.inspection.rowCounts)})
          </Text>
        ) : (
          <Text variant="caption" color={c.negative}>
            ✗ {check.message}
          </Text>
        ))}
      {m && (
        <Row style={{ flexWrap: 'wrap', marginTop: space.xs }}>
          <Button compact kind="secondary" icon="verified" label="Check integrity" disabled={busy} onPress={onVerify} />
          <Button compact kind="secondary" icon="settings_backup_restore" label="Restore" disabled={busy} onPress={onRestore} />
          <Button compact kind="ghost" label="Delete" disabled={busy} onPress={onDelete} />
        </Row>
      )}
    </Card>
  );
}

export default function BackupScreen() {
  const c = useColors();
  const auth = useGoogleAccount();
  const status = useBackupStatus().data;
  const remotes = useRemoteBackups();
  const actions = useBackupActions();
  const backUp = useBackUpNow();
  const confirmRestore = useConfirmRestore();
  const [checks, setChecks] = useState<Record<string, VerifyResult>>({});
  const [checking, setChecking] = useState<string | null>(null);

  if (!status) return <Loading />;
  const meta = status.meta;
  const busy =
    actions.restoreRemote.isPending || actions.restoreFile.isPending || actions.undo.isPending || actions.remove.isPending || backUp.pending;

  const restoreDone = { onSuccess: (r: Parameters<typeof restoredMessage>[0]) => notify('Restored', restoredMessage(r)) };
  const restoreFailed = (e: Error) => notify('Nothing was restored', `${e.message}\n\nThe data on this phone is unchanged.`);

  const verify = (remote: RemoteBackup) => {
    const fileId = remote.fileId;
    setChecking(fileId);
    actions.verify.mutate(remote, {
      onSuccess: (r) => setChecks((prev) => ({ ...prev, [fileId]: r })),
      onError: (e) => notify('Could not check this backup', e.message),
      onSettled: () => setChecking(null),
    });
  };
  const restore = (remote: RemoteBackup) => {
    const manifest = remote.manifest;
    if (!manifest) return;
    confirmRestore(manifest, `the backup of ${formatTimestamp(manifest.createdAt)}`, () =>
      actions.restoreRemote.mutate(remote, { ...restoreDone, onError: restoreFailed }),
    );
  };
  const remove = (remote: RemoteBackup) => {
    const fileId = remote.fileId;
    confirmAction('Delete this backup?', 'It is removed from Google Drive. Your data on this phone is not affected.', 'Delete', () =>
      actions.remove.mutate(fileId, { onError: (e) => notify('Not deleted', e.message) }),
    true);
  };
  const restoreFromFile = async () => {
    let file: Awaited<ReturnType<typeof pickFile>>;
    try {
      file = await pickFile();
    } catch (e) {
      notify('Could not open the file', (e as Error).message);
      return;
    }
    if (!file) return;
    if (!isSqliteFile(file.bytes)) {
      notify('Not a backup file', `“${file.name}” is not a Money Tracker backup (.db). Nothing was changed.`);
      return;
    }
    const picked = file;
    confirmRestore(null, `the file “${picked.name}”`, () => actions.restoreFile.mutate(picked, { ...restoreDone, onError: restoreFailed }));
  };
  const undo = () =>
    confirmAction(
      'Undo the restore?',
      `This puts back the recovery copy (${meta.recoveryLabel ?? 'data before the restore'}, ${formatTimestamp(meta.recoveryAt ?? '')}). The data on this phone now becomes the new recovery copy, so this can be undone too.`,
      'Undo restore',
      () =>
        actions.undo.mutate(undefined, {
          onSuccess: (r) => notify('Previous data put back', restoredMessage(r)),
          onError: restoreFailed,
        }),
      true,
    );

  const list = remotes.data ?? [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.lg, paddingBottom: 64, gap: space.sm }}>
      <NotSyncNote />
      <Card padded={false}>
        <GoogleAccountRow />
      </Card>
      {busy && (
        <Banner tone="info" icon="hourglass_top" title="Working…">
          Keep the app open until this finishes.
        </Banner>
      )}

      {meta.recoveryAt && (
        <>
          <SectionHeader title="Recovery copy on this phone" />
          <Card style={{ gap: space.sm }}>
            <Text variant="bodyStrong">{meta.recoveryLabel}</Text>
            <Text variant="label" tone="muted">
              Saved {formatTimestamp(meta.recoveryAt)}
              {meta.recoverySize ? ` · ${formatBytes(meta.recoverySize)}` : ''}
              {meta.lastRestoreSource ? ` · last restore: ${meta.lastRestoreSource}` : ''}
            </Text>
            <Button kind="secondary" icon="undo" label="Undo restore" disabled={busy} onPress={undo} />
          </Card>
        </>
      )}

      <SectionHeader
        title="Backups on Google Drive"
        action={auth.status === 'signed-in' ? { label: 'Refresh', onPress: () => remotes.refetch() } : undefined}
      />
      {auth.status !== 'signed-in' ? (
        <Card>
          <Text tone="muted">
            {auth.status === 'unsupported' ? 'Google Drive backups are available in the Android app.' : 'Sign in with Google to see and make backups.'}
          </Text>
        </Card>
      ) : (
        <>
          <Button label="Back up now" icon="backup" loading={backUp.pending} disabled={busy} onPress={backUp.start} />
          {remotes.isLoading ? (
            <Loading />
          ) : remotes.error ? (
            <Banner tone="danger" title="Could not load backups">
              {remotes.error.message}
            </Banner>
          ) : list.length === 0 ? (
            <Card>
              <Text tone="muted">No backups yet.</Text>
            </Card>
          ) : (
            list.map((r) => (
              <BackupCard
                key={r.fileId}
                remote={r}
                mine={r.manifest?.deviceId === meta.deviceId}
                current={!status.unbackedChanges && r.manifest?.backupId === meta.baselineBackupId}
                check={checks[r.fileId]}
                busy={busy || checking === r.fileId}
                onVerify={() => verify(r)}
                onRestore={() => restore(r)}
                onDelete={() => remove(r)}
              />
            ))
          )}
          <SectionHeader title="Keep" />
          <Card style={{ gap: space.sm }}>
            <ChipGroup>
              {KEEP_BACKUP_CHOICES.map((n) => (
                <Chip
                  key={n}
                  label={`Last ${n}`}
                  selected={meta.keepBackups === n}
                  onPress={() => actions.setKeep.mutate(n, { onError: (e) => notify('Not saved', e.message) })}
                />
              ))}
            </ChipGroup>
            <Text variant="caption" tone="muted">
              After each verified backup, this phone’s older backups beyond this number are deleted. Backups from other devices, the newest
              backup and the only backup are never deleted automatically.
            </Text>
          </Card>
        </>
      )}

      <SectionHeader title="From a file" />
      <Card style={{ gap: space.sm }}>
        <Text variant="label" tone="muted">
          Restore a backup file saved with Export data → Full backup file. It is opened and checked (SQLite integrity, data version)
          before anything on this phone changes.
        </Text>
        <Button kind="secondary" icon="folder_open" label="Restore from a file" disabled={busy} onPress={restoreFromFile} />
      </Card>

      <Divider />
      <Text variant="caption" tone="faint">
        This phone: device {meta.deviceId.slice(0, 8)} · {status.unbackedChanges ? 'changes not backed up' : 'no changes since the last backup or restore'}
        {meta.lastRestoreAt ? ` · last restore ${formatTimestamp(meta.lastRestoreAt)}` : ''}
      </Text>
      <View style={{ height: space.lg }} />
    </ScrollView>
  );
}
