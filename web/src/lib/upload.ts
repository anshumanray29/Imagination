import { useCallback, useState } from 'react';
import type { Asset } from '@imagination/shared';
import { api } from './api';
import { toast } from '@/components/toast';

export function useUpload() {
  const [uploading, setUploading] = useState(false);
  const upload = useCallback(async (files: File[] | FileList | null | undefined): Promise<Asset[]> => {
    const list = Array.from(files ?? []).filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (!list.length) return [];
    setUploading(true);
    try {
      const assets = await api.upload(list);
      toast.success(`Uploaded ${assets.length} file${assets.length > 1 ? 's' : ''}`);
      return assets;
    } catch (err) {
      toast.error(err);
      return [];
    } finally {
      setUploading(false);
    }
  }, []);
  return { upload, uploading };
}

export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

/** Files from a paste event (screenshots, copied images). */
export function filesFromClipboard(e: ClipboardEvent | React.ClipboardEvent): File[] {
  const items = Array.from(e.clipboardData?.items ?? []);
  return items.map((i) => (i.kind === 'file' ? i.getAsFile() : null)).filter((f): f is File => Boolean(f));
}
