import type { StorageMode } from '../../types';

export type ImportResult = {
  id: string;
  src: string;
  name: string;
  date: string;
  width: number;
  height: number;
  orientation: 'landscape' | 'portrait' | 'square';
  fileSize?: number;
  storageMode: StorageMode;
  relativePath?: string;
  blobId?: string;
  originalBlobId?: string;
  previewBlobId?: string;
  /** P1-1 LOD：256px 缩略图 blob ID */
  thumbBlobId?: string;
};
