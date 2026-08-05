/**
 * File System Access API 最小类型声明
 *
 * TypeScript 内置 DOM 类型未包含 queryPermission/requestPermission 等方法，
 * 因此项目内统一使用本模块声明的类型，避免与内置类型冲突。
 */

export interface FSAHandle {
  kind: 'file' | 'directory';
  name: string;
}

export interface FSAFileHandle extends FSAHandle {
  kind: 'file';
  getFile(): Promise<File>;
}

export interface FSADirectoryHandle extends FSAHandle {
  kind: 'directory';
  getDirectoryHandle(name: string): Promise<FSADirectoryHandle>;
  getFileHandle(name: string): Promise<FSAFileHandle>;
  entries(): AsyncIterableIterator<[string, FSAHandle]>;
  queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FSADirectoryHandle>;
  }
}
