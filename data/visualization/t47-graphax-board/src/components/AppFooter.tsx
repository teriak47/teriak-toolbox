import { cn } from '@/lib/utils';

const SOURCE_URL =
  'https://github.com/teriak47/teriak-toolbox/tree/main/data/visualization/t47-graphax-board';

interface AppFooterProps {
  className?: string;
}

// Footer signature: fur shards are one of their three codified uses in SECTION 21
export function AppFooter({ className }: AppFooterProps) {
  return (
    <footer
      className={cn(
        'shrink-0 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-2 border-t border-filet bg-zinc-900 text-xs text-zinc-500',
        className
      )}
    >
      <span className="inline-flex items-center gap-3">
        <span className="s21-shards" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>Teriak47 — outil d'archive personnelle</span>
      </span>
      <span className="inline-flex items-center gap-4 font-mono">
        <span className="s21-cote">T47/GRAPHAX</span>
        <span title="Version de Graphax">v{__APP_VERSION__}</span>
        <a
          href={SOURCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-zinc-500 hover:text-cyan-400 no-underline"
        >
          ▸ code source
        </a>
      </span>
    </footer>
  );
}
