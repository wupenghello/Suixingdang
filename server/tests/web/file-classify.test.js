import { describe, it, expect } from 'vitest';
import {
  getPreviewType,
  fileTypeBadge,
  PREVIEW_IMAGE_EXT,
  PREVIEW_VIDEO_EXT,
  PREVIEW_AUDIO_EXT,
} from '../../app/web/assets/utils/file-classify.js';

describe('getPreviewType', () => {
  it('图片（大小写归一）', () => {
    expect(getPreviewType('photo.PNG')).toBe('image');
    expect(getPreviewType('a.jpg')).toBe('image');
    expect(getPreviewType('a.webp')).toBe('image');
  });

  it('视频', () => {
    expect(getPreviewType('clip.mp4')).toBe('video');
    expect(getPreviewType('old.mov')).toBe('video');
  });

  it('音频', () => {
    expect(getPreviewType('song.mp3')).toBe('audio');
    expect(getPreviewType('song.flac')).toBe('audio');
  });

  it('PDF', () => {
    expect(getPreviewType('doc.pdf')).toBe('pdf');
  });

  it('文本/代码（扩展名命中）', () => {
    expect(getPreviewType('readme.md')).toBe('text');
    expect(getPreviewType('app.js')).toBe('text');
    expect(getPreviewType('config.json')).toBe('text');
  });

  it('无扩展名特例：Dockerfile / Makefile / .gitignore → text', () => {
    expect(getPreviewType('Dockerfile')).toBe('text');
    expect(getPreviewType('Makefile')).toBe('text');
    expect(getPreviewType('.gitignore')).toBe('text');
  });

  it('未知类型 → null', () => {
    expect(getPreviewType('archive.zip')).toBe(null);
    expect(getPreviewType('data.dat')).toBe(null);
    expect(getPreviewType('noext')).toBe(null);
  });

  // ===== 真实行为记录（非缺陷）=====
  it('ogg 在 video/audio 数组重叠（容器可装音/视频）', () => {
    expect(PREVIEW_VIDEO_EXT).toContain('ogg');
    expect(PREVIEW_AUDIO_EXT).toContain('ogg');
  });

  it('getPreviewType 优先级 image > video > audio，故 .ogg 归为 video', () => {
    expect(getPreviewType('x.ogg')).toBe('video');
  });
});

describe('fileTypeBadge（新增：文件类型语义色/标签分类 — 与 getPreviewType 解耦）', () => {
  // 15 类全覆盖：pdf/doc/xls/ppt/md/img/video/audio/archive/code/text/app/design/other
  const CASES = [
    ['合同.pdf',     'type-pdf',     'PDF'],
    ['报告.doc',     'type-doc',     'DOC'],
    ['报告.docx',    'type-doc',     'DOC'],
    ['数据.xlsx',    'type-xls',     'XLS'],
    ['数据.csv',     'type-xls',     'XLS'],
    ['演示.pptx',    'type-ppt',     'PPT'],
    ['笔记.md',      'type-md',      'MD'],
    ['README.txt',   'type-md',      'MD'],
    ['照片.jpg',     'type-img',     '图片'],
    ['截图.png',     'type-img',     '图片'],
    ['动画.gif',     'type-img',     '图片'],
    ['录像.mp4',     'type-video',   '视频'],
    ['电影.mkv',     'type-video',   '视频'],
    ['音乐.mp3',     'type-audio',   '音频'],
    ['音乐.flac',    'type-audio',   '音频'],
    ['备份.zip',     'type-archive', '压缩'],
    ['归档.tar.gz',  'type-archive', '压缩'],
    ['代码.py',      'type-code',    '代码'],
    ['代码.ts',      'type-code',    '代码'],
    ['代码.rs',      'type-code',    '代码'],
    ['配置.json',    'type-text',    '文本'],
    ['样式.css',     'type-text',    '文本'],
    ['Dockerfile',   'type-text',    '文本'],
    ['安装包.exe',   'type-app',     '应用'],
    ['安装包.dmg',   'type-app',     '应用'],
    ['图标.sketch',  'type-design',  '设计'],
    ['矢量.ai',      'type-design',  '设计'],
    ['未知.xyz',     'type-other',   '文件'],
    ['',             'type-other',   '文件'],
  ];

  it.each(CASES)('fileTypeBadge(%j) → cls=%s, label=%s', (name, cls, label) => {
    expect(fileTypeBadge(name)).toEqual({ cls, label });
  });

  it('不含 type- 前缀以外的裸名：保证 CSS class 形态一致', () => {
    const r = fileTypeBadge('a.pdf');
    expect(r.cls.startsWith('type-')).toBe(true);
  });

  it('隔离不变量：getPreviewType 行为未因新增 fileTypeBadge 受影响', () => {
    // 回归：pdf/doc/xls 是"文档预览类型"（text/null），但"文件类型 badge"独立
    expect(getPreviewType('a.pdf')).toBe('pdf');       // 预览类型不变
    expect(getPreviewType('a.doc')).toBe(null);        // doc 无预览（null），但 badge=doc
    expect(getPreviewType('a.xlsx')).toBe(null);       // xlsx 无预览，但 badge=xls
    expect(fileTypeBadge('a.doc').cls).toBe('type-doc'); // badge 独立于预览
    expect(fileTypeBadge('a.xlsx').cls).toBe('type-xls');
  });

  it('路径（含 /）/ 大写扩展名 / 多后缀名：均取最后一段的最后扩展名', () => {
    expect(fileTypeBadge('/foo/bar/baz.PDF').cls).toBe('type-pdf');     // 大写归一
    expect(fileTypeBadge('photos/2025/photo.jpeg').cls).toBe('type-img'); // 目录+图片
    expect(fileTypeBadge('a.b.c.js').cls).toBe('type-code');            // 多后缀取末尾
  });
});
