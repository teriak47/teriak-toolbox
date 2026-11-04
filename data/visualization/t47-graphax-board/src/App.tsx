import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import type { Project } from '@shared/types';
import { api } from '@/api/client';
import { Dashboard } from '@/components/Dashboard';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// The graph workspace is loaded when a project is opened, so the project list starts faster
const Workspace = lazy(() =>
  import('@/components/Workspace').then((m) => ({ default: m.Workspace }))
);

function WorkspaceLoading() {
  return (
    <div className="h-screen w-screen bg-zinc-950 flex items-center justify-center gap-3 text-zinc-300">
      <span className="s21-slit" aria-hidden="true" />
      <span className="text-sm">Chargement de l'espace de travail…</span>
    </div>
  );
}

function readInitialProjectId(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('project');
}

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() =>
    readInitialProjectId()
  );

  const refreshProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const { projects: list } = await api.listProjects();
      setProjects(list);
    } catch (err) {
      console.error('[Graphax] Impossible de charger les projets :', err);
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  useEffect(() => {
    const onPopState = () => {
      setActiveProjectId(readInitialProjectId());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const openProject = (projectId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('project', projectId);
    window.history.pushState({}, '', url);
    setActiveProjectId(projectId);
  };

  const backToDashboard = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('project');
    window.history.pushState({}, '', url);
    setActiveProjectId(null);
    void refreshProjects();
  };

  if (activeProjectId) {
    return (
      <ErrorBoundary key={`ws-${activeProjectId}-${resetKey}`} onReset={() => setResetKey((k) => k + 1)}>
        <Suspense fallback={<WorkspaceLoading />}>
          <Workspace projectId={activeProjectId} onBack={backToDashboard} onOpenProject={openProject} />
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary key={`dash-${resetKey}`} onReset={() => setResetKey((k) => k + 1)}>
      <Dashboard
        projects={projects}
        loading={loadingProjects}
        onRefresh={refreshProjects}
        onOpenProject={openProject}
      />
    </ErrorBoundary>
  );
}
