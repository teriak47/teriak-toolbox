import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatRelativeDate(iso: string): string {
  try {
    const date = new Date(iso);
    return new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return iso;
  }
}

export function stripMarkdownPreview(md: string, maxLen = 95): string {
  if (!md) return '';
  const plain = md
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/[#>*_`~\-[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= maxLen) return plain;
  return `${plain.slice(0, maxLen).trim()}…`;
}

// File-name friendly slug that keeps accented letters readable ("Opération" -> "operation")
export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function exportFileName(projectName: string, date = new Date()): string {
  return `graphax-${slugify(projectName) || 'projet'}-${date.toISOString().slice(0, 10)}.json`;
}
