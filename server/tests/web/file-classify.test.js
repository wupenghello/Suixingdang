import { describe, it, expect } from 'vitest';
import {
  getPreviewType,
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
