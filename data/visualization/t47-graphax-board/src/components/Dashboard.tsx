import { useRef, useState } from 'react';
import {
  BookOpen,
  Download,
  FolderOpen,
  GitBranch,
  Layers,
  Network,
  Pencil,
  Plus,
  Search,
  Shield,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { Project, ProjectPreset } from '@shared/types';
import { api } from '@/api/client';
import { cn, formatRelativeDate } from '@/lib/utils';
import { downloadProjectExport } from '@/lib/exportProject';
import { AppFooter } from '@/components/AppFooter';
import logoWhite from '@/ds/assets/logo-white.svg';

interface DashboardProps {
  projects: Project[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onOpenProject: (projectId: string) => void;
}

const PRESET_OPTIONS: Array<{
  value: ProjectPreset;
  title: string;
  subtitle: string;
  icon: typeof Shield;
  accent: string;
}> = [
  {
    value: 'osint',
    title: 'Investigation / OSINT & Cyber',
    subtitle: 'Acteur, IP/Infra, Domaine, Malware, Organisation, Preuve, Hypothèse',
    icon: Shield,
    accent: 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10',
  },
  {
    value: 'lore',
    title: 'Lore, Fiction & Histoire',
    subtitle: 'Personnage, Faction, Lieu, Événement, Artefact, Théorie',
    icon: BookOpen,
    accent: 'text-purple-400 border-purple-500/40 bg-purple-500/10',
  },
  {
    value: 'research',
    title: 'Recherche & Analyse Complexe',
    subtitle: 'Concept Clé, Source, Auteur, Hypothèse, Contradiction',
    icon: Search,
    accent: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
  },
  {
    value: 'empty',
    title: 'Projet Vierge',
    subtitle: 'Démarrer sans catégorie prédéfinie (100% sur-mesure)',
    icon: Layers,
    accent: 'text-zinc-300 border-filet-fort bg-zinc-800/50',
  },
];

export function Dashboard({ projects, loading, onRefresh, onOpenProject }: DashboardProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [preset, setPreset] = useState<ProjectPreset>('osint');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const openCreate = () => {
    setEditingProject(null);
    setName('');
    setDescription('');
    setPreset('osint');
    setError(null);
    setShowCreateModal(true);
  };

  const openEdit = (proj: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProject(proj);
    setName(proj.name);
    setDescription(proj.description);
    setError(null);
    setShowCreateModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (editingProject) {
        await api.updateProject(editingProject.id, {
          name: name.trim(),
          description: description.trim(),
        });
        await onRefresh();
        setShowCreateModal(false);
      } else {
        const { project } = await api.createProject({
          name: name.trim(),
          description: description.trim(),
          preset,
        });
        await onRefresh();
        setShowCreateModal(false);
        onOpenProject(project.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateDemo = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { projectId } = await api.createDemoProject();
      await onRefresh();
      onOpenProject(projectId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de créer le projet démo.');
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async (proj: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await downloadProjectExport(proj.id, proj.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l’export JSON.');
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setBusy(true);
    setError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const { project } = await api.importProject(parsed);
      await onRefresh();
      onOpenProject(project.id);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Import échoué : ${err.message}`
          : 'Fichier JSON invalide ou corrompu.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDeleteId !== projectId) {
      setConfirmDeleteId(projectId);
      return;
    }
    setBusy(true);
    try {
      await api.deleteProject(projectId);
      setConfirmDeleteId(null);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de supprimer le projet.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen w-screen overflow-y-auto flex flex-col bg-zinc-950 text-zinc-100">
      <div className="relative w-full flex-1 max-w-6xl mx-auto px-6 py-10 space-y-8">
        {/* Top Brand & Primary Actions */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-5 pb-6 border-b border-filet/80">
          <div className="flex items-center gap-3.5">
            <img src={logoWhite} alt="Teriak47" className="w-11 h-11 shrink-0" />
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Graphax</h1>
                <span className="s21-cote">T47/GRAPHAX · SURREALDB LOCAL</span>
              </div>
              <p className="text-sm text-zinc-400">
                Tableau d'enquête & graphe d'analyse interactif — 100% local sur disque
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImportFile}
              className="hidden"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-filet text-zinc-200 transition-colors"
            >
              <Upload className="w-3.5 h-3.5 text-zinc-400" />
              <span>Importer .json</span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={handleCreateDemo}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-filet text-amber-300 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Charger projet démo</span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-zinc-950 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Nouveau Projet</span>
            </button>
          </div>
        </header>

        {error && (
          <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-rose-950/50 border border-rose-500/40 text-xs text-rose-200">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Projects Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                className="h-48 rounded-2xl bg-zinc-900/60 border border-filet/80"
              />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-20 px-6 rounded-3xl bg-zinc-900/40 border border-dashed border-filet">
            <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-filet flex items-center justify-center mb-4">
              <Network className="w-7 h-7 text-cyan-400" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-100 mb-1.5">
              Aucun dossier d'analyse pour le moment
            </h2>
            <p className="text-sm text-zinc-400 max-w-md mb-6">
              Créez votre premier tableau d'enquête (OSINT, Cyber, Lore, Recherche), importez une
              sauvegarde <code className="text-cyan-300">.json</code> ou explorez le projet de
              démonstration pré-rempli.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-zinc-950 transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Créer un projet</span>
              </button>
              <button
                type="button"
                onClick={handleCreateDemo}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-filet text-amber-300 transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                <span>Découvrir avec un graphe démo</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((proj) => (
              <div
                key={proj.id}
                onClick={() => onOpenProject(proj.id)}
                className="group relative flex flex-col justify-between p-5 rounded-2xl bg-zinc-900/85 hover:bg-zinc-900 border border-filet hover:border-cyan-500/50 transition-all cursor-pointer"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-base text-zinc-100 group-hover:text-cyan-300 transition-colors line-clamp-1">
                      {proj.name}
                    </h3>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => openEdit(proj, e)}
                        title="Renommer / modifier la description"
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleExport(proj, e)}
                        title="Exporter la sauvegarde .json complète"
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-cyan-300 hover:bg-zinc-800 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleDelete(proj.id, e)}
                        title="Supprimer ce projet"
                        className={cn(
                          'px-2 py-1.5 rounded-lg text-xs transition-colors inline-flex items-center gap-1',
                          confirmDeleteId === proj.id
                            ? 'bg-rose-600 text-white font-medium'
                            : 'text-zinc-400 hover:text-rose-400 hover:bg-zinc-800'
                        )}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        {confirmDeleteId === proj.id && <span>Confirmer</span>}
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-zinc-400 line-clamp-2 min-h-[32px]">
                    {proj.description || 'Aucune description renseignée.'}
                  </p>
                </div>

                <div className="pt-4 mt-4 border-t border-filet/80 space-y-3">
                  <div className="flex items-center gap-3 text-xs text-zinc-300 font-mono">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-950 border border-filet">
                      <Layers className="w-3 h-3 text-cyan-400" />
                      {proj.nodeCount ?? 0} nœuds
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-950 border border-filet">
                      <GitBranch className="w-3 h-3 text-emerald-400" />
                      {proj.edgeCount ?? 0} liens
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span>Modifié : {formatRelativeDate(proj.updatedAt)}</span>
                    <span className="inline-flex items-center gap-1 text-cyan-400 font-medium transition-transform">
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Ouvrir</span>
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AppFooter />

      {/* Create / Edit Project Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-zinc-900 border border-filet shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-filet">
              <h3 className="text-sm font-semibold text-zinc-100">
                {editingProject ? 'Modifier le dossier' : 'Nouveau dossier d’analyse'}
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Nom du projet
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Enquête Ransomware X, Chronologie Elden Ring…"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-950 border border-filet text-zinc-100 placeholder-zinc-500 focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Description (optionnelle)
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Objectif de l'enquête, périmètre, sources principales…"
                  className="w-full px-3 py-2 text-xs rounded-lg bg-zinc-950 border border-filet text-zinc-200 placeholder-zinc-500 focus:border-cyan-500 focus:outline-none resize-none"
                />
              </div>

              {!editingProject && (
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-2">
                    Jeu de catégories initial (modifiable à tout moment)
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {PRESET_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      const selected = preset === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setPreset(opt.value)}
                          className={cn(
                            'flex items-start gap-3 p-3 rounded-xl border text-left transition-all',
                            selected
                              ? 'bg-cyan-500/10 border-cyan-400'
                              : 'bg-zinc-950 border-filet hover:border-filet-fort'
                          )}
                        >
                          <div
                            className={cn(
                              'w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 mt-0.5',
                              opt.accent
                            )}
                          >
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-zinc-100">{opt.title}</div>
                            <div className="text-xs text-zinc-400 mt-0.5">{opt.subtitle}</div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-filet">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3.5 py-2 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={!name.trim() || busy}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-cyan-500 hover:bg-cyan-400 text-zinc-950 disabled:opacity-50"
                >
                  {busy
                    ? 'Enregistrement…'
                    : editingProject
                      ? 'Enregistrer'
                      : 'Créer et ouvrir'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
