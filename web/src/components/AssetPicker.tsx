import { useEffect, useState } from 'react';
import { Check, Images, Upload } from 'lucide-react';
import type { MediaKind } from '@imagination/shared';
import { useAssets } from '@/lib/queries';
import { pickFiles, useUpload } from '@/lib/upload';
import { MediaThumb } from './MediaThumb';
import { Button, Chip, Empty, Modal } from './ui';

/** Pick existing assets from the library or upload new ones. */
export function AssetPicker({
  open,
  onClose,
  onPick,
  max = 1,
  kind = 'image',
  title = 'Choose images',
}: {
  open: boolean;
  onClose: () => void;
  onPick: (ids: string[]) => void;
  max?: number;
  kind?: MediaKind;
  title?: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [source, setSource] = useState<'all' | 'upload' | 'generated'>('all');
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useAssets({ kind, source: source === 'all' ? undefined : source });
  const { upload, uploading } = useUpload();
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  useEffect(() => {
    if (open) setSelected([]);
  }, [open]);

  const toggle = (id: string) => {
    if (max === 1) {
      onPick([id]);
      onClose();
      return;
    }
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= max ? s : [...s, id]));
  };

  const doUpload = async () => {
    const assets = await upload(await pickFiles(kind === 'image' ? 'image/*' : 'video/*', max > 1));
    if (!assets.length) return;
    const ids = assets.slice(0, max).map((a) => a.id);
    onPick(ids);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={title} className="max-w-4xl h-[80vh]">
      <div className="flex items-center gap-2 border-b border-line px-5 py-3">
        {(['all', 'generated', 'upload'] as const).map((s) => (
          <Chip key={s} active={source === s} onClick={() => setSource(s)}>
            {s === 'all' ? 'All' : s === 'generated' ? 'Generated' : 'Uploads'}
          </Chip>
        ))}
        <div className="flex-1" />
        <Button variant="primary" size="sm" icon={<Upload className="size-3.5" />} loading={uploading} onClick={doUpload}>
          Upload from computer
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-5">
        {!isLoading && !items.length ? (
          <Empty icon={<Images className="size-5" />} title="Nothing here yet">
            Upload {kind === 'image' ? 'images' : 'videos'} from your computer, or generate some in the Studio.
          </Empty>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
            {items.map((a) => {
              const pos = selected.indexOf(a.id);
              return (
                <MediaThumb
                  key={a.id}
                  asset={a}
                  selected={pos >= 0}
                  hoverPlay={false}
                  onClick={() => toggle(a.id)}
                  overlay={
                    pos >= 0 && (
                      <span className="absolute top-1.5 left-1.5 flex size-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-zinc-950">
                        {max > 1 ? pos + 1 : <Check className="size-3.5" />}
                      </span>
                    )
                  }
                />
              );
            })}
          </div>
        )}
        {hasNextPage && (
          <div className="mt-4 flex justify-center">
            <Button size="sm" loading={isFetchingNextPage} onClick={() => fetchNextPage()}>
              Load more
            </Button>
          </div>
        )}
      </div>
      {max > 1 && (
        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <span className="text-sm text-muted">
            {selected.length} / {max} selected
          </span>
          <Button
            variant="primary"
            disabled={!selected.length}
            onClick={() => {
              onPick(selected);
              onClose();
            }}
          >
            Use selected
          </Button>
        </div>
      )}
    </Modal>
  );
}
