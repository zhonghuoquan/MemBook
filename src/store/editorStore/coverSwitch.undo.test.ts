/**
 * 封面模板切换 + 撤销/重做 回归测试（2026-08-19）
 *
 * 覆盖场景2（撤销/重做）关键行为：
 * 1. 纯切换模板（未编辑）后撤销：封面副标题/日期内容精确还原到旧模板。
 * 2. 编辑副标题/日期后切换模板再撤销：还原用户编辑后的内容。
 * 3. 书脊日期编辑后切换模板+撤销：书脊文字沿用用户版本且精确还原。
 * 4. BUG 回归：编辑文字未退出时切模板，TextDomNode 卸载清理会调用 updateTextElement
 *    （元素已被迁移丢弃），修复前会压一条「冗余快照」，导致第一次撤销恢复到新模板
 *    而非旧封面——即「撤销后应用了模板效果、内容不对」。修复后元素不存在时不压快照。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../editorStore';
import { usePhotoStore } from '../photoStore';
import { useHistoryStore } from '../historyStore';
import type { Photo } from '../../types';

// jsdom 无 canvas 2D context：mock measureText（wrapTextLines/fitTextSize 依赖）
beforeEach(() => {
  const fakeCtx: any = { font: '', measureText: (s: string) => ({ width: String(s).length * 8 }) };
  (HTMLCanvasElement.prototype as any).getContext = () => fakeCtx;
});

const ALBUM = { id: 'standard', name: '标准', width: 210, height: 280, desc: '' };

function makePhotos(n: number): Photo[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    src: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    name: `photo-${i}.jpg`,
    date: '2024-01-01',
    width: 800,
    height: 600,
    orientation: 'landscape' as const,
    storageMode: 'import' as const,
  }));
}

beforeEach(() => {
  useHistoryStore.getState().clear();
  useEditorStore.setState({
    pages: [],
    albumSize: ALBUM,
    projectName: '我的相册',
    currentPageIndex: 0,
  });
  usePhotoStore.setState({ photos: makePhotos(6) });
});

async function apply(templateId: string) {
  // 元素 id 用 Date.now() 生成：连续 apply 需间隔 >1ms 避免 id 碰撞（真实操作自然间隔）
  await new Promise((r) => setTimeout(r, 5));
  await useEditorStore.getState().applyCoverTemplate(templateId);
}

function undo() {
  const entry = useHistoryStore.getState().undo();
  expect(entry).not.toBeNull();
  useEditorStore.getState().setPages(entry!.pages);
}

function cover() {
  return useEditorStore.getState().pages.find((p) => p.pageKind === 'cover')!;
}

function texts(idPrefix: string) {
  return (cover().textElements || []).filter((e) => e.id.startsWith(idPrefix));
}

describe('封面模板切换 + 撤销（场景2）', () => {
  it('纯切换模板（未编辑）后撤销：副标题内容精确还原', async () => {
    await apply('cover-2');
    expect(texts('cover-text-subtitle')[0].text).toBe('The World Around You');

    await apply('cover-3');
    undo();

    expect(cover().templateId).toBe('cover-2');
    expect(texts('cover-text-subtitle')[0]?.text).toBe('The World Around You');
  });

  it('编辑副标题后切换模板再撤销：还原用户编辑内容', async () => {
    await apply('cover-2');
    const subA = texts('cover-text-subtitle')[0];
    useEditorStore.getState().updateTextElement(0, subA.id, { text: '我的自定义副标题' }, true);

    await apply('cover-3');
    expect(texts('cover-text-subtitle')[0].text).not.toBe('我的自定义副标题');

    undo();
    expect(cover().templateId).toBe('cover-2');
    expect(texts('cover-text-subtitle')[0]?.text).toBe('我的自定义副标题');
  });

  it('编辑封面日期后单次切换撤销：日期内容精确还原', async () => {
    await apply('cover-2');
    const dateA = texts('cover-text-date')[0];
    useEditorStore.getState().updateTextElement(0, dateA.id, { text: '2019-2024' }, true);

    await apply('cover-3');
    undo();

    expect(cover().templateId).toBe('cover-2');
    expect(texts('cover-text-date')[0]?.text).toBe('2019-2024');
  });

  it('书脊日期编辑后切换模板+撤销：书脊文字沿用用户版本', async () => {
    await apply('cover-2');
    const spineDate = texts('spine-text-date')[0];
    useEditorStore.getState().updateTextElement(0, spineDate.id, { text: '书脊自定义日期' }, true);

    await apply('cover-3');
    expect(texts('spine-text-date')[0]?.text).toBe('书脊自定义日期');

    undo();
    expect(cover().templateId).toBe('cover-2');
    expect(texts('spine-text-date')[0]?.text).toBe('书脊自定义日期');
  });

  it('BUG回归：编辑文字未退出时切模板，卸载清理不应产生冗余快照，第一次撤销回到旧封面', async () => {
    await apply('cover-2');
    const subA = texts('cover-text-subtitle')[0];
    useEditorStore.getState().updateTextElement(0, subA.id, { text: '我的副标题' }, true);

    await apply('cover-3');
    // 模拟 TextDomNode 卸载清理：编辑中的元素已被迁移丢弃，此时补 updateTextElement 不应再产生快照
    useEditorStore.getState().updateTextElement(0, subA.id, { text: '残留内容' }, true);
    expect(texts('cover-text-subtitle').find((e) => e.id === subA.id)).toBeUndefined();

    // 第一次撤销必须回到 cover-2（含用户编辑），而不是 cover-3
    undo();
    expect(cover().templateId).toBe('cover-2');
    expect(texts('cover-text-subtitle')[0]?.text).toBe('我的副标题');
  });
});
