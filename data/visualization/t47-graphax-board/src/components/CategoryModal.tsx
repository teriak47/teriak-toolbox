import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { Category, CategoryIconName, CategoryShape } from '@shared/types';
import {
  CATEGORY_COLORS,
  CATEGORY_ICON_MAP,
  CATEGORY_SHAPES,
  getShapeRadiusClass,
} from '@/lib/icons';
import { cn } from '@/lib/utils';

interface CategoryModalProps {
  isOpen: boolean;
  initialCategory?: Category | null;
  onClose: () => void;
  onSave: (data: {
    name: string;
    color: string;
    icon: CategoryIconName;
    shape: CategoryShape;
  }) => Promise<void>;
  onDelete?: (categoryId: string) => Promise<void>;
}

export function CategoryModal({
  isOpen,
  initialCategory,
  onClose,
  onSave,
  onDelete,
}: CategoryModalProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#38bdf8');
  const [icon, setIcon] = useState<CategoryIconName>('tag');
  const [shape, setShape] = useState<CategoryShape>('rounded');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(initialCategory?.name ?? '');
      setColor(initialCategory?.color ?? '#38bdf8');
      setIcon(initialCategory?.icon ?? 'tag');
      setShape(initialCategory?.shape ?? 'rounded');
      setConfirmDelete(false);
    }
  }, [isOpen, initialCategory]);

  if (!isOpen) return null;

  const PreviewIcon = CATEGORY_ICON_MAP[icon]?.icon ?? CATEGORY_ICON_MAP.tag.icon;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), color, icon, shape });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!initialCategory || !onDelete || saving) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    try {
      await onDelete(initialCategory.id);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-zinc-900 border border-zinc-800 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-100">
            {initialCategory ? 'Modifier la catégorie' : 'Nouvelle catégorie'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Live Badge Preview */}
          <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800/80">
            <span className="text-xs text-zinc-400">Aperçu sur carte :</span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium',
                getShapeRadiusClass(shape)
              )}
              style={{
                backgroundColor: `${color}22`,
                color,
                border: `1px solid ${color}55`,
              }}
            >
              <PreviewIcon className="w-3.5 h-3.5" />
              <span>{name.trim() || 'Nom de catégorie'}</span>
            </span>
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Nom de la catégorie
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Suspect, Serveur C2, Faction, Théorie…"
              className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-100 placeholder-zinc-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          {/* Color Palette + Custom Hex Picker */}
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Couleur</label>
            <div className="flex flex-wrap items-center gap-2">
              {CATEGORY_COLORS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setColor(hex)}
                  className={cn(
                    'w-6 h-6 rounded-full transition-transform',
                    color.toLowerCase() === hex.toLowerCase()
                      ? 'scale-115 ring-2 ring-white ring-offset-2 ring-offset-zinc-900'
                      : 'hover:scale-110 opacity-85 hover:opacity-100'
                  )}
                  style={{ backgroundColor: hex }}
                />
              ))}
              <label
                title="Couleur personnalisée"
                className="relative inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 cursor-pointer hover:border-zinc-700"
              >
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-4 h-4 bg-transparent border-0 cursor-pointer p-0"
                />
                <span className="font-mono text-[11px] uppercase">{color}</span>
              </label>
            </div>
          </div>

          {/* Icon Selector */}
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Icône</label>
            <div className="grid grid-cols-8 gap-1.5">
              {(
                Object.entries(CATEGORY_ICON_MAP) as Array<
                  [CategoryIconName, (typeof CATEGORY_ICON_MAP)[CategoryIconName]]
                >
              ).map(([key, item]) => {
                const IconComp = item.icon;
                const active = icon === key;
                return (
                  <button
                    key={key}
                    type="button"
                    title={item.label}
                    onClick={() => setIcon(key)}
                    className={cn(
                      'flex items-center justify-center h-9 rounded-lg border transition-all',
                      active
                        ? 'bg-cyan-500/15 border-cyan-400 text-cyan-300'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                    )}
                  >
                    <IconComp className="w-4 h-4" />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Shape Selector */}
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">
              Style de bordure
            </label>
            <div className="grid grid-cols-4 gap-2">
              {CATEGORY_SHAPES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setShape(s.value)}
                  className={cn(
                    'px-2.5 py-1.5 text-xs font-medium border transition-colors',
                    s.radiusClass,
                    shape === s.value
                      ? 'bg-cyan-500/15 border-cyan-400 text-cyan-300'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-zinc-800">
            {initialCategory && onDelete ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  confirmDelete
                    ? 'bg-rose-600 text-white hover:bg-rose-500'
                    : 'text-rose-400 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/30'
                )}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{confirmDelete ? 'Confirmer suppression' : 'Supprimer'}</span>
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={!name.trim() || saving}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500 text-zinc-950 hover:bg-cyan-400 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Enregistrement…' : initialCategory ? 'Mettre à jour' : 'Créer'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
