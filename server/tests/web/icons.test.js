import { describe, it, expect } from 'vitest';
import { ICONS, getFileIcon } from '../../app/web/assets/utils/icons.js';

describe('ICONS', () => {
  it('关键 key 存在且为完整 <svg> 字符串', () => {
    const keys = ['folder', 'file', 'fileCode', 'copy', 'tbCheck', 'search', 'send', 'close', 'trash', 'download'];
    for (const k of keys) {
      expect(typeof ICONS[k]).toBe('string');
      expect(ICONS[k].startsWith('<svg')).toBe(true);
      expect(ICONS[k]).toContain('</svg>');
    }
  });

  it('tbCheck：复制成功反馈图标是对勾（回归 _enhanceMarkdownDom 引用的 ICONS.tbCheck——原代码漏定义，复制后按钮显示 undefined）', () => {
    expect(ICONS.tbCheck).toMatch(/<polyline/);
    expect(ICONS.tbCheck).toContain('</svg>');
  });
});

describe('getFileIcon', () => {
  it('目录 → folder', () => {
    expect(getFileIcon('anything', true).cls).toBe('folder');
    expect(getFileIcon('anything', true).icon).toBe(ICONS.folder);
  });

  it('代码文件 → code', () => {
    expect(getFileIcon('a.js').cls).toBe('code');
    expect(getFileIcon('b.py').cls).toBe('code');
    expect(getFileIcon('c.ts').cls).toBe('code');
  });

  it('文档 → doc', () => {
    expect(getFileIcon('a.pdf').cls).toBe('doc');
    expect(getFileIcon('b.md').cls).toBe('doc');
  });

  it('图片 → image', () => {
    expect(getFileIcon('a.png').cls).toBe('image');
    expect(getFileIcon('b.jpg').cls).toBe('image');
  });

  it('视频 → video', () => {
    expect(getFileIcon('a.mp4').cls).toBe('video');
  });

  it('音频 → audio', () => {
    expect(getFileIcon('a.mp3').cls).toBe('audio');
    expect(getFileIcon('b.flac').cls).toBe('audio');
  });

  it('未知/无扩展名 → other', () => {
    expect(getFileIcon('a.zip').cls).toBe('other');
    expect(getFileIcon('noext').cls).toBe('other');
  });

  it('大小写归一（.PNG 与 .png 同类）', () => {
    expect(getFileIcon('A.PNG').cls).toBe('image');
  });

  it('返回的 icon 引用 ICONS 中对应 SVG（不重复定义）', () => {
    expect(getFileIcon('a.js').icon).toBe(ICONS.fileCode);
    expect(getFileIcon('a.png').icon).toBe(ICONS.fileImage);
  });
});
