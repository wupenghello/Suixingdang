// 文件类型分类工具（从 app.js 抽离，行为不变）
// 注：getFileIcon 依赖 ICONS 常量，暂留 app.js，待 ICONS 一并抽离时再迁入（S2）。

export const PREVIEW_IMAGE_EXT = ['png','jpg','jpeg','gif','svg','webp','bmp','ico','avif'];
export const PREVIEW_VIDEO_EXT = ['mp4','webm','ogg','mov','mkv','avi','m4v'];
export const PREVIEW_AUDIO_EXT = ['mp3','wav','ogg','flac','m4a','aac','opus'];
export const PREVIEW_TEXT_EXT = ['txt','md','rst','json','yml','yaml','xml','html','htm','css','scss','less','js','ts','jsx','tsx','py','java','go','rs','c','cpp','h','hpp','sh','bash','rb','php','sql','log','conf','ini','toml','env','csv','tsv','vue','svelte','swift','kt','dart','lua','pl','r','scala','clj','dockerfile','makefile','gitignore','graphql','proto'];
export const PREVIEW_PDF_EXT = ['pdf'];

// —— 文件类型语义色 / 文本标签（用于 type-badge + 图标类别名）——
// 纯函数：仅做「文件名 → {cls,label}」映射，不动 getPreviewType（预览流真源）。
// 颜色 tokens 在 tokens.css --type-* 中定义；label 为 2–3 字中文/英文缩写。
const _TYPE_MAP = {
  pdf:  { cls: 'pdf',  label: 'PDF' },
  doc:  { cls: 'doc',  label: 'DOC' },
  xls:  { cls: 'xls',  label: 'XLS' },
  ppt:  { cls: 'ppt',  label: 'PPT' },
  md:   { cls: 'md',   label: 'MD' },
  img:  { cls: 'img',  label: '图片' },
  video:{ cls: 'video',label: '视频' },
  audio:{ cls: 'audio',label: '音频' },
  archive:{cls:'archive',label:'压缩'},
  code: { cls: 'code', label: '代码' },
  text: { cls: 'text', label: '文本' },
  app:  { cls: 'app',  label: '应用' },
  design:{cls:'design',label:'设计' },
  other:{ cls: 'other',label: '文件' },
};
const _EXT_TO_CLS = {
  // 文档
  pdf:'pdf', doc:'doc', docx:'doc', odt:'doc', pages:'doc', rtf:'doc',
  // 表格
  xls:'xls', xlsx:'xls', csv:'xls', ods:'lxs', tsv:'xls',
  // 演示
  ppt:'ppt', pptx:'ppt', odp:'ppt', key:'ppt',
  // 笔记文本
  md:'md', markdown:'md', mkd:'md', mdown:'md', txt:'md', rst:'md',
  // 图片
  png:'img', jpg:'img', jpeg:'img', gif:'img', webp:'img', svg:'img',
  ico:'img', bmp:'img', avif:'img', tif:'img', tiff:'img', heic:'img',
  // 视频
  mp4:'video', mov:'video', mkv:'video', webm:'video', avi:'video',
  m4v:'video', flv:'video', wmv:'video',
  // 音频
  mp3:'audio', wav:'audio', flac:'audio', ogg:'audio', aac:'audio',
  opus:'audio', m4a:'audio', aiff:'audio',
  // 压缩
  zip:'archive', gz:'archive', bz2:'archive', rar:'archive', '7z':'archive',
  tar:'archive', xz:'archive', tgz:'archive', zst:'archive',
  // 代码
  js:'code', ts:'code', jsx:'code', tsx:'code', py:'code', java:'code',
  go:'code', rs:'code', c:'code', cpp:'code', h:'code', hpp:'code',
  rb:'code', php:'code', sh:'code', bash:'code', zsh:'code', swift:'code',
  kt:'code', dart:'code', scala:'code', clj:'code', cs:'code', vb:'code',
  lua:'code', pl:'code', r:'code',
  // 配置/数据（走 doc-muted 类，label 文本）
  json:'text', yml:'text', yaml:'text', toml:'text', xml:'text', ini:'text',
  conf:'text', env:'text', log:'text', cnf:'text', csv_text:'text',
  graphql:'text', proto:'text', sql:'text', dockerfile:'text',
  makefile:'text',gitignore:'text', html:'text', htm:'text', css:'text',
  scss:'text', less:'text', vue:'text', svelte:'text',
  // 应用
  exe:'app', dmg:'app', msi:'app', deb:'app', rpm:'app', appimage:'app',
  apk:'app', pkg:'app',
  // 设计
  sketch:'design', fig:'design', psd:'design', ai:'design', indd:'design',
  eps:'design', xd:'design', ae:'design', pr:'design',
};
const _BASENAME_TO_CLS = { dockerfile:'text', makefile:'text', '.gitignore':'text' };

export function fileTypeBadge(name) {
  if (!name) return { cls: 'type-other', label: '文件' };
  const baseName = String(name).split('/').pop() || '';
  const ext = (baseName.split('.').pop() || '').toLowerCase();
  const baseKey = baseName.toLowerCase();
  const cls = _BASENAME_TO_CLS[baseKey] || _EXT_TO_CLS[ext] || 'other';
  const hit = _TYPE_MAP[cls] || _TYPE_MAP.other;
  return { cls: 'type-' + cls, label: hit.label };
}

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
