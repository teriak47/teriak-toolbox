import { Link2, Maximize2, MousePointer2, Orbit, Pause, Play, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CanvasDockProps {
  toolMode: 'select' | 'link';
  onSelectMode: () => void;
  onToggleLinkMode: () => void;
  physicsActive: boolean;
  /** The live physics is on but asleep, the graph being still */
  physicsSettled: boolean;
  onTogglePhysics: () => void;
  onOrganize: () => void;
  zoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitView: () => void;
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

// Floating tool bar at the bottom of the canvas (O6): tools, physics, layout and zoom
export function CanvasDock({
  toolMode,
  onSelectMode,
  onToggleLinkMode,
  physicsActive,
  physicsSettled,
  onTogglePhysics,
  onOrganize,
  zoom,
  onZoomOut,
  onZoomIn,
  onFitView,
}: CanvasDockProps) {
  return (
    <div
      onMouseDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 p-1.5 rounded-2xl bg-zinc-900/92 border border-filet shadow-2xl z-20"
    >
      <button
        type="button"
        onClick={onSelectMode}
        title="Mode Sélection & Déplacement (V) — Astuce : tirez l'anneau extérieur d'un nœud ou Shift+Glisser pour relier"
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors',
          toolMode === 'select'
            ? 'bg-zinc-800 text-zinc-100 border border-filet-fort'
            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
        )}
      >
        <MousePointer2 className="w-3.5 h-3.5" />
        <span>Déplacer</span>
      </button>

      <button
        type="button"
        onClick={onToggleLinkMode}
        title="Mode Liaison rapide (L) — Cliquez Nœud A puis Nœud B"
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors',
          toolMode === 'link'
            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50'
            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
        )}
      >
        <Link2 className="w-3.5 h-3.5" />
        <span>Relier</span>
      </button>

      <div className="h-4 w-px bg-zinc-800 mx-1" />

      <button
        type="button"
        onClick={onTogglePhysics}
        title={
          physicsActive && physicsSettled
            ? 'Simulation stable : en pause automatique jusqu’au prochain déplacement. Cliquer pour la désactiver.'
            : 'Activer / figer la simulation physique élastique (style Obsidian Graph View)'
        }
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors',
          physicsActive
            ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
        )}
      >
        {physicsActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        <span>Physique</span>
      </button>

      <button
        type="button"
        onClick={onOrganize}
        title="Espacer harmonieusement le graphe en constellation"
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium text-zinc-400 hover:text-amber-300 hover:bg-zinc-800/50 transition-colors"
      >
        <Orbit className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Constellation</span>
      </button>

      <div className="h-4 w-px bg-zinc-800 mx-1" />

      <button
        type="button"
        onClick={onZoomOut}
        title="Dézoomer"
        className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
      >
        <ZoomOut className="w-3.5 h-3.5" />
      </button>

      <span className="px-1.5 text-xs font-mono text-zinc-400 min-w-[42px] text-center">
        {Math.round(zoom * 100)}%
      </span>

      <button
        type="button"
        onClick={onZoomIn}
        title="Zoomer"
        className="p-1.5 rounded-xl text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
      >
        <ZoomIn className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        onClick={onFitView}
        title="Recentrer sur tout le graphe"
        className="p-1.5 rounded-xl text-zinc-400 hover:text-cyan-300 hover:bg-zinc-800/60"
      >
        <Maximize2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
