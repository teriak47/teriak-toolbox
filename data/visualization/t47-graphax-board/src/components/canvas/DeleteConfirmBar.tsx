export interface PendingDelete {
  kind: 'node' | 'edge' | 'nodes';
  id: string;
  label: string;
  /** For 'nodes': the multiple selection being deleted */
  ids?: string[];
}

interface DeleteConfirmBarProps {
  pending: PendingDelete;
  onConfirm: () => void;
  onCancel: () => void;
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

// Confirmation asked at the top of the canvas before a keyboard deletion (O6)
export function DeleteConfirmBar({ pending, onConfirm, onCancel }: DeleteConfirmBarProps) {
  return (
    <div
      role="alertdialog"
      aria-labelledby="graphax-delete-confirm-title"
      onMouseDown={stop}
      onClick={stop}
      onDoubleClick={stop}
      className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-zinc-900/95 border border-rose-500/40 shadow-2xl z-30 max-w-[calc(100%-2rem)]"
    >
      <p id="graphax-delete-confirm-title" className="text-xs text-zinc-200 min-w-0">
        {pending.kind === 'nodes' ? (
          <>
            Supprimer les <strong className="text-zinc-50">{pending.label} nœuds</strong> sélectionnés et
            tous leurs liens ?
          </>
        ) : pending.kind === 'node' ? (
          <>
            Supprimer le nœud <strong className="text-zinc-50 break-words">« {pending.label} »</strong> et
            tous ses liens ?
          </>
        ) : pending.label ? (
          <>
            Supprimer le lien <strong className="text-zinc-50 break-words">« {pending.label} »</strong> ?
          </>
        ) : (
          <>Supprimer ce lien ?</>
        )}
        <span className="block text-[11px] text-zinc-400 mt-0.5">Entrée pour confirmer, Échap pour annuler.</span>
      </p>
      <button
        type="button"
        autoFocus
        onClick={onConfirm}
        className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-600 text-white hover:bg-rose-500"
      >
        Supprimer
      </button>
      <button type="button" onClick={onCancel} className="shrink-0 text-xs text-zinc-400 hover:text-zinc-200">
        Annuler
      </button>
    </div>
  );
}
