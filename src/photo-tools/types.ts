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

/** 重复类型
 * - exact: 字节级完全相同（SHA256 哈希匹配）
 * - visual: 视觉相同但字节不同（pHash 汉明距离 ≤ 阈值，如 EXIF 差异/重新压缩）
 */
export type DuplicateSimilarity = 'exact' | 'visual';

/** 去重组：一组内容相同（精确或视觉）的文件 */
export interface DedupeGroup {
  /** 组内序号 */
  groupId: string;
  /** SHA256 哈希（前 16 位用于展示）；visual 类型时为 pHash */
  hashShort: string;
  /** 完整 SHA256 哈希；visual 类型时为 pHash 全量 */
  hashFull: string;
  /** 组内所有文件 */
  files: PhotoFileInfo[];
  /** 建议保留的文件索引 */
  keepIndex: number;
  /** 文件大小 (bytes；exact 组内相同，visual 组内可能不同，取首个) */
  fileSize: number;
  /** 重复类型：精确匹配 / 视觉相似 */
  similarity: DuplicateSimilarity;
  /** visual 类型时的汉明距离（0 = pHash 完全相同），exact 类型为 0 */
  distance?: number;
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
  /** 精确匹配组数（SHA256 完全相同） */
  exactGroups?: number;
  /** 视觉相似组数（pHash 汉明距离 ≤ 阈值） */
  visualGroups?: number;
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

// ══════════════════════════════════════════════════════════
// 功能2：按地点归类
// ══════════════════════════════════════════════════════════

/** 归类模式：时间 / 地点 / 时间+地点 */
export type OrganizeMode = 'time' | 'location' | 'time-location';

/** 地点层级
 * - 'province': 省级
 * - 'city': 市级
 * - 'district': 区县级
 * - 'full': 省/市/区县 三级完整路径（用户确认的默认选项）
 */
export type LocationLevel = 'province' | 'city' | 'district' | 'full';

// ══════════════════════════════════════════════════════════
// 功能5：相似照片聚类（非精确重复）
// ══════════════════════════════════════════════════════════

/** 相似照片组（pHash 距离 6-15，非精确重复） */
export interface SimilarGroup {
  groupId: string;
  files: PhotoFileInfo[];
  /** 建议保留的文件索引（computeKeepScore 评分最高） */
  keepIndex: number;
  /** pHash 距离范围（组内最大距离） */
  maxDistance: number;
  /** 平均 pHash 距离 */
  avgDistance: number;
}

// ══════════════════════════════════════════════════════════
// 功能6：批量重命名
// ══════════════════════════════════════════════════════════

/** 重命名预览条目 */
export interface RenamePreviewItem {
  photo: PhotoFileInfo;
  oldName: string;
  newName: string;
  /** 冲突处理：序号后缀 */
  conflictSuffix?: number;
}

/** 重命名模板变量 */
export interface RenameTemplateVars {
  date: string;       // 2024-01-15
  location: string;   // 上海
  seq: string;        // 001
  camera: string;     // iPhone15Pro
  original: string;   // 原文件名（不含扩展名）
}

// ══════════════════════════════════════════════════════════
// 功能1：按人物归类（人脸聚类）
// ══════════════════════════════════════════════════════════

/** 单个人脸 descriptor + 位置信息 */
export interface FaceRecord {
  /** 128 维 face-api descriptor */
  descriptor: Float32Array;
  /** 人脸在图片中的相对位置（0-1） */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 检测置信度 */
  score: number;
  /** 所属照片 ID */
  photoId: string;
}

/** 人脸聚类组 */
export interface FaceCluster {
  clusterId: string;
  /** 组内所有人脸记录 */
  faces: FaceRecord[];
  /** 关联的照片列表（去重） */
  photos: PhotoFileInfo[];
  /** 代表性人脸（面积最大/置信度最高） */
  representativeFace: FaceRecord;
  /** 组内照片数 */
  photoCount: number;
  /** 用户自定义组名（可选，如"妈妈"） */
  customName?: string;
}

/** 人脸聚类结果 */
export interface FaceClusterResult {
  clusters: FaceCluster[];
  /** 未识别人脸的照片 */
  noFacePhotos: PhotoFileInfo[];
  /** 总处理照片数 */
  totalPhotos: number;
  /** 检测到人脸的照片数 */
  photosWithFaces: number;
  /** 处理失败的照片数（模型加载失败/读取异常等） */
  failedPhotos: number;
  /** 模型是否加载失败（区分"模型未加载"与"未检测到人脸"） */
  modelLoadFailed?: boolean;
}

/** 人脸检测中间结果（用于分离检测与聚类，支持调阈值即时重聚类） */
export interface FaceDetectionResult {
  /** 所有检测到的人脸记录 */
  faces: FaceRecord[];
  /** 检测到人脸的照片 ID 集合 */
  photosWithFacesSet: Set<string>;
  /** 处理失败的照片数 */
  failedCount: number;
  /** 模型是否加载失败 */
  modelLoadFailed: boolean;
  /** 总照片数 */
  totalPhotos: number;
  /** 模型加载失败的具体原因（modelLoadFailed=true 时有值） */
  loadErrorMessage?: string;
}

// ══════════════════════════════════════════════════════════
// 功能3：时间线/日历视图
// ══════════════════════════════════════════════════════════

/** 时间线分组（按年-月） */
export interface TimelineGroup {
  key: string;        // "2024-03"
  year: number;
  month: number;
  photos: PhotoFileInfo[];
  /** 是否包含异常日期（年份 < 2000 或 > 当前年+1） */
  hasAnomaly: boolean;
}

/** 日历日期项 */
export interface CalendarDay {
  date: Date;
  photos: PhotoFileInfo[];
  isCurrentMonth: boolean;
  isAnomaly: boolean;
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

// ══════════════════════════════════════════════════════════
// 功能：截图识别
// ══════════════════════════════════════════════════════════

/** 截图判定置信度 */
export type ScreenshotConfidence = 'high' | 'suspect';

/** 截图识别命中信号类型 */
export type ScreenshotSignal =
  | 'filename'        // 文件名含截图关键词
  | 'noCamera'        // EXIF 无相机厂商/型号（真实照片几乎必有）
  | 'software'        // EXIF Software 字段含截图特征
  | 'screenRes'       // 分辨率精确匹配常见屏幕尺寸
  | 'screenRatio'     // 宽高比接近常见屏幕比例（如 16:9 / 19.5:9）
  | 'pngNoExif';      // PNG 格式且完全无 EXIF 元数据段

/** 单张照片的截图识别结果 */
export interface ScreenshotItem {
  photo: PhotoFileInfo;
  /** 置信度：high = 判定为截图，suspect = 疑似截图（待用户复核） */
  confidence: ScreenshotConfidence;
  /** 命中原因（UI 展示“判定依据”） */
  reasons: string[];
}

/** 截图识别整体结果 */
export interface ScreenshotDetectResult {
  /** 判定为截图 */
  screenshots: ScreenshotItem[];
  /** 疑似截图（低置信度，供用户复核勾选） */
  suspects: ScreenshotItem[];
  /** 正常照片 */
  normalPhotos: PhotoFileInfo[];
  /** 总照片数 */
  totalPhotos: number;
  /** 处理失败的照片数（读取/解码失败） */
  failedPhotos: number;
}

/** 截图识别选项 */
export interface ScreenshotDetectOptions {
  /** 读取照片数据（统一入口） */
  readData: (photo: PhotoFileInfo) => Promise<ArrayBuffer | null>;
  /** 进度回调 */
  onProgress?: (p: ToolProgress) => void;
  /** 中止信号 */
  signal?: AbortSignal;
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

/**
 * 单个整理工具的结果摘要（供“一键分析结果报告页”收集展示）
 *
 * 每个工具完成扫描后通过 ToolProps.onResultSummary 上报给面板，
 * 面板汇总后生成“一键分析”结果报告，让用户看到整理的价值。
 */
export interface ToolResultSummary {
  /** 工具名 */
  tool: string;
  /** 是否有结果（true 表示本次扫描产生了结果） */
  hasResult: boolean;
  /** 该工具发现的“问题”数量（重复张数 / 相似组数 / 截图张数 / 人脸组数） */
  count: number;
  /** 副标题统计（可空） */
  subCount?: number;
  /** 一句话描述 */
  label: string;
  /** 可跳转处理的目标工具 */
  targetTool: string;
  /** 主题色 */
  color: string;
}
