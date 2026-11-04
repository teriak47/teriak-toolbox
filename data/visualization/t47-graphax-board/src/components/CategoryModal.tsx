import { useEffect, useState } from 'react';
import { Eye, EyeOff, Plus, Trash2, X } from 'lucide-react';
import {
  DEFAULT_CATEGORY_COLOR,
  DEFAULT_CATEGORY_ICON,
  DEFAULT_CATEGORY_SHAPE,
  MAX_CARD_KEYS,
  MAX_CATEGORY_KEYS,
  MAX_METADATA_KEY_LENGTH,
  normalizeCategoryKeys,
  type Category,
  type CategoryIconName,
  type CategoryShape,
} from '@shared/types';
import type { CategoryInput } from '@/api/client';
import {
  CATEGORY_COLORS,
  CATEGORY_ICON_MAP,
  CATEGORY_SHAPES,
  getShapeRadiusClass,
} from '@/lib/icons';
import { cn } from '@/lib/utils';
import { ShapeGlyph } from '@/components/ShapeGlyph';

interface CategoryModalProps {
  isOpen: boolean;
  initialCategory?: Category | null;
  onClose: () => void;
  onSave: (data: CategoryInput) => Promise<void>;
  onDelete?: (categoryId: string) => Promise<void>;
  /** Keys already used in the project, offered while typing a default key */
  knownKeys?: string[];
}

type KeyRow = { id: string; key: string; onCard: boolean };

let keyRowSeq = 0;
const newKeyRow = (key = '', onCard = false): KeyRow => ({ id: `k${++keyRowSeq}`, key, onCard });

export function CategoryModal({
  isOpen,
  initialCategory,
  onClose,
  onSave,
  onDelete,
  knownKeys = [],
}: CategoryModalProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_CATEGORY_COLOR);
  const [icon, setIcon] = useState<CategoryIconName>(DEFAULT_CATEGORY_ICON);
  const [shape, setShape] = useState<CategoryShape>(DEFAULT_CATEGORY_SHAPE);
  const [keyRows, setKeyRows] = useState<KeyRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(initialCategory?.name ?? '');
      setColor(initialCategory?.color ?? DEFAULT_CATEGORY_COLOR);
      setIcon(initialCategory?.icon ?? DEFAULT_CATEGORY_ICON);
      setShape(initialCategory?.shape ?? DEFAULT_CATEGORY_SHAPE);
      const card = new Set(initialCategory?.cardKeys ?? []);
      setKeyRows((initialCategory?.metadataKeys ?? []).map((k) => newKeyRow(k, card.has(k))));
      setConfirmDelete(false);
    }
  }, [isOpen, initialCategory]);

  if (!isOpen) return null;

  const PreviewIcon = CATEGORY_ICON_MAP[icon]?.icon ?? CATEGORY_ICON_MAP.tag.icon;
  const cardCount = keyRows.filter((r) => r.onCard && r.key.trim()).length;
  const updateKeyRow = (id: string, patch: Partial<KeyRow>) =>
    setKeyRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const keys = normalizeCategoryKeys(
        keyRows.map((r) => r.key),
        keyRows.filter((r) => r.onCard).map((r) => r.key)
      );
      await onSave({ name: name.trim(), color, icon, shape, ...keys });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md max-h-[calc(100vh-2rem)] flex flex-col rounded-2xl bg-zinc-900 border border-filet shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-filet">
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

        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          {/* Live preview: the node as drawn on the graph, and the category badge */}
          <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-filet/80">
            <span className="text-xs text-zinc-400">Aperçu sur le graphe :</span>
            <span className="flex items-center gap-3">
              <span className="relative inline-flex items-center justify-center w-12 h-12">
                <ShapeGlyph
                  shape={shape}
                  size={48}
                  stroke={color}
                  fill="var(--surface-carte)"
                  strokeWidth={1.6}
                />
                <PreviewIcon className="absolute w-4 h-4" style={{ color }} />
              </span>
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
                <span>{name.trim() || 'Nom de catégorie'}</span>
              </span>
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
              className="w-full px-3 py-2 text-sm rounded-lg bg-zinc-950 border border-filet text-zinc-100 placeholder-zinc-500 focus:border-cyan-500 focus:outline-none"
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
                    'w-6 h-6',
                    color.toLowerCase() === hex.toLowerCase()
                      ? 'ring-2 ring-zinc-100 ring-offset-2 ring-offset-zinc-900'
                      : 'opacity-85 hover:opacity-100'
                  )}
                  style={{ backgroundColor: hex }}
                />
              ))}
              <label
                title="Couleur personnalisée"
                className="relative inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-zinc-950 border border-filet text-xs text-zinc-300 cursor-pointer hover:border-filet-fort"
              >
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-4 h-4 bg-transparent border-0 cursor-pointer p-0"
                />
                <span className="font-mono text-xs uppercase">{color}</span>
              </label>
            </div>
          </div>

          {/* Icon Selector */}
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Icône</label>
            <div className="grid grid-cols-9 gap-1.5">
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
                        : 'bg-zinc-950 border-filet text-zinc-400 hover:text-zinc-200 hover:border-filet-fort'
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
              Forme du nœud
            </label>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Forme du nœud">
              {CATEGORY_SHAPES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={shape === s.value}
                  onClick={() => setShape(s.value)}
                  className={cn(
                    'flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium border transition-colors',
                    shape === s.value
                      ? 'bg-cyan-500/15 border-cyan-400 text-cyan-300'
                      : 'bg-zinc-950 border-filet text-zinc-400 hover:text-zinc-200'
                  )}
                >
                  <ShapeGlyph shape={s.value} size={16} />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Default metadata keys, and the ones shown on the node card */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-zinc-300">Champs par défaut</label>
              <button
                type="button"
                disabled={keyRows.length >= MAX_CATEGORY_KEYS}
                onClick={() => setKeyRows((rows) => [...rows, newKeyRow()])}
                className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus className="w-3 h-3" />
                <span>Champ</span>
              </button>
            </div>
            <p className="text-xs text-zinc-500 mb-2">
              Ajoutés vides aux nœuds de cette catégorie. L'œil affiche la valeur sous le titre du
              nœud ({MAX_CARD_KEYS} max).
            </p>
            {keyRows.length === 0 ? (
              <p className="text-xs text-zinc-500 italic">Aucun champ (ex. IP, Pays, Statut…).</p>
            ) : (
              <div className="space-y-1.5">
                {keyRows.map((row) => {
                  const cardFull = !row.onCard && cardCount >= MAX_CARD_KEYS;
                  const cardTitle = row.onCard
                    ? 'Affiché sur la carte du nœud (cliquer pour masquer)'
                    : cardFull
                      ? `${MAX_CARD_KEYS} champs sont déjà affichés sur la carte`
                      : 'Afficher la valeur sur la carte du nœud';
                  return (
                    <div key={row.id} className="flex items-center gap-1.5">
                      <input
                        type="text"
                        list="graphax-category-keys"
                        value={row.key}
                        maxLength={MAX_METADATA_KEY_LENGTH}
                        onChange={(e) => updateKeyRow(row.id, { key: e.target.value })}
                        placeholder="Clé (ex. IP)"
                        aria-label="Nom du champ"
                        className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono rounded-md bg-zinc-950 border border-filet text-zinc-200 placeholder-zinc-500 focus:border-cyan-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        aria-pressed={row.onCard}
                        disabled={cardFull}
                        title={cardTitle}
                        aria-label={cardTitle}
                        onClick={() => updateKeyRow(row.id, { onCard: !row.onCard })}
                        className={cn(
                          'p-1.5 rounded-md border transition-colors disabled:opacity-35 disabled:cursor-not-allowed',
                          row.onCard
                            ? 'bg-cyan-500/15 border-cyan-400 text-cyan-300'
                            : 'bg-zinc-950 border-filet text-zinc-500 hover:text-zinc-200'
                        )}
                      >
                        {row.onCard ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="button"
                        title="Retirer ce champ"
                        aria-label="Retirer ce champ"
                        onClick={() => setKeyRows((rows) => rows.filter((r) => r.id !== row.id))}
                        className="p-1.5 rounded-md text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <datalist id="graphax-category-keys">
              {knownKeys.map((k) => (
                <option key={k} value={k} />
              ))}
            </datalist>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-filet">
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
