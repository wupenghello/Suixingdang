// 文件类型分类工具（从 app.js 抽离，行为不变）
// 注：getFileIcon 依赖 ICONS 常量，暂留 app.js，待 ICONS 一并抽离时再迁入（S2）。

export const PREVIEW_IMAGE_EXT = ['png','jpg','jpeg','gif','svg','webp','bmp','ico','avif'];
export const PREVIEW_VIDEO_EXT = ['mp4','webm','ogg','mov','mkv','avi','m4v'];
export const PREVIEW_AUDIO_EXT = ['mp3','wav','ogg','flac','m4a','aac','opus'];
export const PREVIEW_TEXT_EXT = ['txt','md','rst','json','yml','yaml','xml','html','htm','css','scss','less','js','ts','jsx','tsx','py','java','go','rs','c','cpp','h','hpp','sh','bash','rb','php','sql','log','conf','ini','toml','env','csv','tsv','vue','svelte','swift','kt','dart','lua','pl','r','scala','clj','dockerfile','makefile','gitignore','graphql','proto'];
export const PREVIEW_PDF_EXT = ['pdf'];

export function getPreviewType(name) {
  const ext = name.split('.').pop().toLowerCase();
  const baseName = name.split('/').pop().toLowerCase();
  if (PREVIEW_IMAGE_EXT.includes(ext)) return 'image';
  if (PREVIEW_VIDEO_EXT.includes(ext)) return 'video';
  if (PREVIEW_AUDIO_EXT.includes(ext)) return 'audio';
  if (PREVIEW_PDF_EXT.includes(ext)) return 'pdf';
  if (PREVIEW_TEXT_EXT.includes(ext) || ['dockerfile','makefile','.gitignore'].includes(baseName)) return 'text';
  return null;
}
