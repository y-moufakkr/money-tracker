import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { formatTimestamp } from '@/domain/dates';
import { useAttachment, useAttachmentUri } from '@/hooks/attachments';
import { EmptyState, Loading, Text } from '@/ui/primitives';
import { space } from '@/ui/theme';

/** A receipt photo, full screen. */
export default function AttachmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const a = useAttachment(id);
  const uri = useAttachmentUri(a.data?.path);

  if (a.isLoading || (a.data && uri.isLoading)) return <Loading />;
  if (!a.data) return <EmptyState icon="image" title="Photo not found" message="It may have been removed." />;
  return (
    <>
      <Stack.Screen options={{ title: 'Receipt' }} />
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {uri.data ? (
          <Image source={{ uri: uri.data }} style={{ flex: 1 }} contentFit="contain" accessibilityLabel="Receipt photo" />
        ) : (
          <EmptyState icon="broken_image" title="Photo file missing" message="Its record is kept; restore a backup to get the file back." />
        )}
        <Text variant="caption" color="#BBB" style={{ textAlign: 'center', padding: space.md }}>
          Added {formatTimestamp(a.data.createdAt)} · {Math.round(a.data.size / 1024)} KB
        </Text>
      </View>
    </>
  );
}
