import { useQuery } from '@tanstack/react-query';

import { attachmentUri } from '@/lib/attachment-store';
import { getAttachment, listAttachments } from '@/services/attachments';
import { useDb } from './data';

export function useAttachments(transactionId: string | undefined) {
  const db = useDb();
  return useQuery({
    queryKey: ['ledger', 'attachments', transactionId],
    queryFn: () => listAttachments(db, transactionId!),
    enabled: !!transactionId,
  });
}

export function useAttachment(id: string | undefined) {
  const db = useDb();
  return useQuery({ queryKey: ['ledger', 'attachment', id], queryFn: () => getAttachment(db, id!), enabled: !!id });
}

/** A displayable URI for a stored photo (null when its file is missing). Files never change, so it is cached. */
export function useAttachmentUri(path: string | undefined) {
  return useQuery({ queryKey: ['attachment-uri', path], queryFn: () => attachmentUri(path!), enabled: !!path, staleTime: Infinity });
}
