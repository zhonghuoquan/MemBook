/**
 * MemBook — 一键备份动作
 *
 * 复用 dataMigration 的全量导出能力，供编辑器工具栏菜单、
 * 自动保存失败横幅等多处入口共享同一套备份流程。
 */
import { exportAllData, saveBackupFile } from './dataMigration';
import { logger } from './logger';

export type BackupResult = {
  ok: boolean;
  /** 用户主动取消保存对话框 */
  cancelled?: boolean;
  message: string;
};

/**
 * 导出全部或单个项目数据为 zip 备份
 * @param projectId  指定项目 ID 时只导出该项目及其照片；否则导出全部数据
 * @param projectName 用于生成备份文件名
 */
export async function exportBackupZip(projectId?: string, projectName?: string): Promise<BackupResult> {
  try {
    const isSingleProject = !!projectId;
    const { blob, warnings } = await exportAllData(
      isSingleProject ? { projectIds: [projectId!] } : {}
    );
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    const safeName = projectName?.trim().replace(/[\\/:*?"<>|]/g, '_') || projectId || 'backup';
    const filename = isSingleProject
      ? `membook-project-backup-${safeName}-${ts}.zip`
      : `membook-backup-${ts}.zip`;
    const saved = await saveBackupFile(blob, filename);
    if (!saved.downloaded) {
      return { ok: false, cancelled: true, message: '已取消导出' };
    }
    const baseMsg = saved.path ? `备份已保存到 ${saved.path}` : '备份已下载';
    const scopeMsg = isSingleProject ? '当前项目' : '全部数据';
    return {
      ok: true,
      message: warnings.length > 0 ? `${scopeMsg}${baseMsg}（${warnings.length} 个警告）` : `${scopeMsg}${baseMsg}`,
    };
  } catch (e) {
    logger.error('[backup] 导出备份失败:', e);
    return { ok: false, message: `导出失败: ${(e as Error).message}` };
  }
}
