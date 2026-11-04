import { useCallback, useEffect, useState } from 'react';
import { Camera, History, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import type { ProjectSnapshot } from '@shared/types';
import { api } from '@/api/client';
import { cn } from '@/lib/utils';

interface SnapshotsModalProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  /** Opens the project created from a snapshot */
  onOpenProject: (projectId: string) => void;
  /**
   * Saves the edits still waiting and waits for the saves in progress; returns a message when
   * some changes are not saved (a snapshot would miss them), null otherwise
   */
  beforeSnapshot?: () => Promise<string | null>;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

// Lists the project's snapshots (A7): take one now, restore one as a new project, delete one
export function SnapshotsModal({
  projectId,
  isOpen,
  onClose,
  onOpenProject,
  beforeSnapshot,
}: SnapshotsModalProps) {
  const [snapshots, setSnapshots] = useState<ProjectSnapshot[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSnapshots((await api.listSnapshots(projectId)).snapshots);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chargement impossible.');
    }
  }, [projectId]);

  useEffect(() => {
    if (!isOpen) return;
    setConfirmDelete(null);
    void load();
  }, [isOpen, load]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const run = async (key: string, op: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await op();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Opération impossible.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="graphax-snapshots-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[calc(100vh-2rem)] flex flex-col rounded-2xl bg-zinc-900 border border-filet shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-filet">
          <h3 id="graphax-snapshots-title" className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <History className="w-4 h-4 text-zinc-400" />
            Instantanés du projet
          </h3>
          <button
            type="button"
            onClick={onClose}
            title="Fermer"
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-filet space-y-2">
          <p className="text-xs text-zinc-400">
            Un instantané automatique est pris toutes les 30 minutes quand le projet a changé (les 10 derniers
            sont gardés). Restaurer crée un nouveau projet : celui-ci n'est pas modifié.
          </p>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run('create', async () => {
                const problem = await beforeSnapshot?.();
                if (problem) throw new Error(problem);
                await api.createSnapshot(projectId);
                await load();
              })
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-zinc-950 disabled:opacity-60"
          >
            {busy === 'create' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
            Prendre un instantané maintenant
          </button>
        </div>

        {error && (
          <p role="alert" className="px-5 py-2 text-xs text-rose-300 border-b border-filet">
            {error}
          </p>
        )}

        <ul className="flex-1 overflow-y-auto divide-y divide-[var(--filet)]">
          {snapshots === null && <li className="px-5 py-4 text-xs text-zinc-500">Chargement…</li>}
          {snapshots?.length === 0 && (
            <li className="px-5 py-4 text-xs text-zinc-500">Aucun instantané pour l'instant.</li>
          )}
          {snapshots?.map((s) => (
            <li key={s.name} className="px-5 py-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-zinc-200">{formatDate(s.createdAt)}</div>
                <div className="text-[11px] text-zinc-500">
                  {s.kind === 'auto' ? 'Automatique' : 'Manuel'} · {s.nodeCount} nœud{s.nodeCount > 1 ? 's' : ''} ·{' '}
                  {s.edgeCount} lien{s.edgeCount > 1 ? 's' : ''}
                </div>
              </div>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void run(`restore:${s.name}`, async () => {
                    const { project } = await api.restoreSnapshot(projectId, s.name);
                    onClose();
                    onOpenProject(project.id);
                  })
                }
                title="Créer un nouveau projet à partir de cet instantané"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-zinc-300 border border-filet hover:bg-zinc-800 disabled:opacity-60"
              >
                {busy === `restore:${s.name}` ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" />
                )}
                Restaurer
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  if (confirmDelete !== s.name) {
                    setConfirmDelete(s.name);
                    return;
                  }
                  void run(`delete:${s.name}`, async () => {
                    await api.deleteSnapshot(projectId, s.name);
                    setConfirmDelete(null);
                    await load();
                  });
                }}
                title={confirmDelete === s.name ? 'Confirmer la suppression' : 'Supprimer cet instantané'}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs disabled:opacity-60',
                  confirmDelete === s.name
                    ? 'bg-rose-600 text-white hover:bg-rose-500'
                    : 'text-rose-400 hover:bg-rose-500/10'
                )}
              >
                <Trash2 className="w-3.5 h-3.5" />
                {confirmDelete === s.name && 'Confirmer'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
