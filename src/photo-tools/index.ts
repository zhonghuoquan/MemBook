/**
 * photo-tools 统一导出
 */

// 类型
export type {
  DataSourceMode,
  PlatformCapability,
  PhotoFileInfo,
  DedupeGroup,
  DedupeResult,
  DuplicateSimilarity,
  OrganizePreviewItem,
  OrganizeResult,
  ExifEditItem,
  ConvertItem,
  ToolProgress,
  ToolResult,
  ToolResultSummary,
  OrganizeMode,
  LocationLevel,
  SimilarGroup,
  RenamePreviewItem,
  RenameTemplateVars,
  FaceRecord,
  FaceCluster,
  FaceClusterResult,
  FaceDetectionResult,
  TimelineGroup,
  CalendarDay,
  ScreenshotItem,
  ScreenshotDetectResult,
  ScreenshotDetectOptions,
  ScreenshotConfidence,
  ScreenshotSignal,
} from './types';

// 平台
export { isTauri, getPlatform, supportsFileSystemWrite, supportsShellCommand, getScriptsBasePath } from './platform';

// 哈希去重
export { deduplicatePhotos, findSimilarPhotos, formatBytes } from './hash';
export type { DedupeOptions, FindSimilarOptions } from './hash';

// 感知哈希
export { computePHash, hammingDistance, DEFAULT_PHASH_THRESHOLD } from './perceptual-hash';

// 文件名时间解析
export { parseFilenameDate } from './filename-time';

// EXIF 读写
export {
  readExifDate,
  readExifDateWithFallback,
  readExifFull,
  readExifGps,
  writeExifDateToJpeg,
  writeExifGpsToJpeg,
  writeExifDate,
  writeExifGps,
  EXIF_WRITABLE_EXTS,
} from './exif';

// 地理编码
export { geocode } from './geocode';
export type { GeoResult } from './geocode';

// 格式转换
export { convertLivpToJpg, convertHeicToJpg, convertToJpg, isConvertible } from './livp-converter';
export type { ConvertOptions, ConvertOutput } from './livp-converter';

// 时间/地点归类
export {
  resolvePhotoDate,
  resolvePhotoDateWithData,
  getTargetDir,
  getTargetDirEx,
  parseLocationLevel,
  previewOrganize,
  executeOrganize,
} from './organize';
export type { PreviewOrganizeOptions, ExecuteOrganizeOptions } from './organize';

// 批量重命名
export { previewRename, executeRename, buildRenameVars } from './rename';
export type { RenameOptions } from './rename';

// 人脸聚类
export { extractFaceDescriptors, detectFaces, recluster, clusterFaces, findFaceClusters } from './face-cluster';
export type { FaceClusterOptions } from './face-cluster';

// 截图识别
export { detectScreenshots } from './screenshot';
