import type { ReactNode } from 'react';
import { File, FileArchive, FileCode, FileImage, FileMusic, FileSpreadsheet, FileText, FileVideoCamera, Folder, Globe, Presentation } from 'lucide-react';
import type { Bookmark } from '@pautaflow/shared';

export interface FileVisual {
  icon: ReactNode;
  color: string;
  label: string;
}

const EXT: { exts: string[]; v: FileVisual }[] = [
  { exts: ['doc', 'docx', 'docm', 'odt', 'rtf', 'dotx'], v: { icon: <FileText />, color: '#2b6cd8', label: 'Word' } },
  { exts: ['xls', 'xlsx', 'xlsm', 'xlsb', 'csv', 'ods'], v: { icon: <FileSpreadsheet />, color: '#16a34a', label: 'Planilha' } },
  { exts: ['ppt', 'pptx', 'pptm', 'odp', 'potx'], v: { icon: <Presentation />, color: '#ea580c', label: 'Apresentação' } },
  { exts: ['pdf'], v: { icon: <FileText />, color: '#dc2626', label: 'PDF' } },
  { exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic', 'tif', 'tiff', 'psd', 'ai'], v: { icon: <FileImage />, color: '#a855f7', label: 'Imagem' } },
  { exts: ['mp4', 'mov', 'avi', 'mkv', 'wmv', 'webm'], v: { icon: <FileVideoCamera />, color: '#db2777', label: 'Vídeo' } },
  { exts: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'], v: { icon: <FileMusic />, color: '#0d9488', label: 'Áudio' } },
  { exts: ['zip', 'rar', '7z', 'tar', 'gz'], v: { icon: <FileArchive />, color: '#a16207', label: 'Compactado' } },
  { exts: ['js', 'ts', 'tsx', 'json', 'py', 'html', 'css', 'xml', 'ps1', 'sql'], v: { icon: <FileCode />, color: '#475569', label: 'Código' } },
  { exts: ['txt', 'md', 'log'], v: { icon: <FileText />, color: '#64748b', label: 'Texto' } },
];

export function extensionOf(location: string): string {
  const base = location.split(/[\\/]/).pop() ?? '';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

export function fileVisual(b: Pick<Bookmark, 'kind' | 'location'>): FileVisual {
  if (b.kind === 'folder') return { icon: <Folder />, color: '#f59e0b', label: 'Pasta' };
  if (b.kind === 'url') return { icon: <Globe />, color: '#0ea5e9', label: 'Link' };
  const ext = extensionOf(b.location);
  return EXT.find((e) => e.exts.includes(ext))?.v ?? { icon: <File />, color: '#64748b', label: ext ? ext.toUpperCase() : 'Arquivo' };
}

/** Ícone do item em uma "pastilha" colorida translúcida. */
export function FileGlyph({ b, size = 40 }: { b: Pick<Bookmark, 'kind' | 'location'>; size?: number }) {
  const v = fileVisual(b);
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[14px] ring-1 ring-inset [&_svg]:size-[45%]"
      style={{
        width: size,
        height: size,
        color: v.color,
        background: `linear-gradient(145deg, color-mix(in srgb, ${v.color} 20%, transparent), color-mix(in srgb, ${v.color} 8%, transparent))`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${v.color} 22%, transparent)`,
      }}
      title={v.label}
    >
      {v.icon}
    </span>
  );
}
