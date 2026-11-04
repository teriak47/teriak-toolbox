import { api } from '@/api/client';
import { exportFileName } from '@/lib/utils';

// Fetches the project bundle from the API and saves it as a JSON file.
// Throws when the export cannot be fetched, so callers can report it.
export async function downloadProjectExport(projectId: string, projectName: string): Promise<void> {
  const bundle = await api.exportProject(projectId);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName(projectName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking right after click() can cancel the download in some browsers
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
