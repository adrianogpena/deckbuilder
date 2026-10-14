import { useCallback, useEffect, useMemo, useState } from 'react';
import { requestBlob } from '@deckbuilder/ui';
import { resolveImagePath } from './resolve-image-path';

const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** `resolveImage` for the markdown preview: loads the project's images through the API as blob URLs. */
export function useLocalImages(project: string, filePath: string): (src: string) => string | null {
  // One cache per file, so loads started for a new file survive the old file's cleanup.
  const cache = useMemo(() => ({ images: new Map<string, string | null>(), live: true }), [project, filePath]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    cache.live = true;
    return () => {
      cache.live = false;
      for (const [path, url] of cache.images) {
        if (url && url !== PLACEHOLDER) {
          URL.revokeObjectURL(url);
          cache.images.delete(path);
        }
      }
    };
  }, [cache]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((src: string) => {
    const path = resolveImagePath(filePath, src);
    if (!path) return null;
    const { images } = cache;
    if (images.has(path)) return images.get(path)!;
    images.set(path, PLACEHOLDER);
    queueMicrotask(() => {
      void requestBlob('/api/fs/raw', { root: project, path })
        .then((blob) => (/\.svg$/i.test(path) && blob.type !== 'image/svg+xml' ? new Blob([blob], { type: 'image/svg+xml' }) : blob))
        .then((blob) => URL.createObjectURL(blob), () => null)
        .then((url) => {
          if (!cache.live || images.get(path) !== PLACEHOLDER) {
            if (url) URL.revokeObjectURL(url);
            if (!cache.live) images.delete(path);
            return;
          }
          images.set(path, url);
          setVersion((v) => v + 1);
        });
    });
    return PLACEHOLDER;
  }, [cache, version]);
}
