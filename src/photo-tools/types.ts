/**
 * photo-tools 共享类型定义
 *
 * 设计原则：
 * - 纯数据结构，无 UI 依赖
 * - 同时支持「真实文件路径」和「库内 Photo 记录」两种场景
 */

/** 数据来源模式 */
export type DataSourceMode = 'folder' | 'library';

/** 平台能力 */
export type PlatformCapability = 'web' | 'tauri';

/** 单张照片/文件的元信息（扫描结果） */
export interface PhotoFileInfo {
  /** 唯一 ID（库内用 photoId，文件系统用完整路径） */
  id: string;
  /** 文件名（含扩展名） */
  name: string;
  /** 文件大小 (bytes) */
  size: number;
  /** 文件扩展名（小写，含点，如 '.jpg'） */
  ext: string;
  /** MIME 类型 */
  mimeType: string;

  // ---- 文件系统特有（mode='folder' 时有值）----
  /** 完整文件路径（仅 folder 模式） */
  path?: string;
  /** 相对于根目录的路径（仅 folder 模式，用于归类目标计算） */
  relativePath?: string;

  // ---- 库内特有（mode='library' 时有值）----
  /** 库内 photoId（仅 library 模式） */
  photoId?: string;
  /** 库内 blobId（仅 library 模式） */
  blobId?: string;

  // ---- EXIF 元数据 ----
  /** EXIF 拍摄日期（ISO 字符串，可能为空） */
  dateTaken?: string;
  /** GPS 经度 */
  gpsLon?: number;
  /** GPS 纬度 */
  gpsLat?: number;
  /** 相机品牌 */
  cameraMake?: string;
  /** 相机型号 */
  cameraModel?: string;
  /** 图像宽度 */
  width?: number;
  /** 图像高度 */
  height?: number;

  // ---- 运行时 ----
  /** 缩略图 URL（用于预览） */
  thumbUrl?: string;
}

/** 去重组：一组内容完全相同的文件 */
export interface DedupeGroup {
  /** 组内序号 */
  groupId: string;
  /** SHA256 哈希（前 16 位用于展示） */
  hashShort: string;
  /** 完整 SHA256 哈希 */
  hashFull: string;
  /** 组内所有文件 */
  files: PhotoFileInfo[];
  /** 建议保留的文件索引 */
  keepIndex: number;
  /** 文件大小 (bytes，组内都一样) */
  fileSize: number;
}

/** 去重结果 */
export interface DedupeResult {
  /** 总组数 */
  totalGroups: number;
  /** 涉及的总文件数 */
  totalFiles: number;
  /** 将删除的文件数 */
  duplicateCount: number;
  /** 将释放的空间 (bytes) */
  freedBytes: number;
  /** 所有重复组 */
  groups: DedupeGroup[];
}

/** 时间归类预览条目 */
export interface OrganizePreviewItem {
  sourcePath: string;
  targetDir: string;   // 如 "MemBook照片整理/2024年/03月"
  fileName: string;
  conflictAction: 'move' | 'rename' | 'skip';
}

/** 时间归类结果 */
export interface OrganizeResult {
  totalFiles: number;
  movedCount: number;
  skippedCount: number;
  items: OrganizePreviewItem[];
}

/** EXIF 编辑项 */
export interface ExifEditItem {
  file: PhotoFileInfo;
  /** 修改前的日期 */
  oldDate?: string;
  /** 新日期 */
  newDate?: string;
  /** 修改前的 GPS */
  oldGps?: { lon: number; lat: number };
  /** 新 GPS */
  newGps?: { lon: number; lat: number };
}

/** 格式转换项 */
export interface ConvertItem {
  source: PhotoFileInfo;
  targetFormat: 'jpg';
  quality: number;
  /** 转换后的 Blob 或路径 */
  result?: Blob | string;
  success?: boolean;
  error?: string;
}

/** 工具执行进度 */
export interface ToolProgress {
  phase: string;
  current: number;
  total: number;
  message?: string;
}

/** 工具执行结果（通用） */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
