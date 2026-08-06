/**
 * MemBook — 版本号与构建信息
 */
declare const __APP_VERSION__: string;
declare const __BUILD_DATE__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.4';
export const BUILD_DATE: string = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : new Date().toISOString().slice(0, 10);
