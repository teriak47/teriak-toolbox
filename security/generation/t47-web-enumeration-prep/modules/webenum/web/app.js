'use strict';
const $ = id => document.getElementById(id);
let token = '', estimatedMask = '', commandText = '';
const recipeKey = 'webenum-recipes-v1';
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json', 'X-T47-Token': token}, body: JSON.stringify(data)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Action impossible.');
  return result;
}
function action(id, fn) { $(id).addEventListener('click', async () => { $(id).disabled = true; try { await fn(); } catch (e) { status(e.message, true); } finally { $(id).disabled = id === 'generate' ? estimatedMask !== $('mask').value : false; } }); }
function invalidateEstimate() { estimatedMask = ''; $('generate').disabled = true; $('estimate-result').hidden = true; }
function invalidateCommands() { $('command-result').hidden = true; commandText = ''; }
function saveBlob(name, text, type) { const url = URL.createObjectURL(new Blob([text], {type})); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function readRecipes() { const parsed = JSON.parse(localStorage.getItem(recipeKey) || '[]'); if (!Array.isArray(parsed)) throw new Error('Recettes invalides.'); return parsed; }
function renderRecipes() { const select = $('recipes'); select.replaceChildren(new Option('Mes recettes', '')); readRecipes().forEach((r, i) => select.add(new Option(r.name, String(i)))); }
function updateDownload() { const id = $('lists').value; $('download').hidden = !id; $('download').href = '/download/webenum/' + id; invalidateCommands(); }
async function refreshLists(selected) { const lists = await api('/api/webenum/lists'); $('lists').replaceChildren(new Option('Choisir une liste', '')); for (const item of lists) $('lists').add(new Option(`${item.mask} · ${item.lines.toLocaleString('fr-BE')} lignes · ${item.id.slice(0,8)}`, item.id)); if (selected) $('lists').value = selected; updateDownload(); }
$('mask').addEventListener('input', invalidateEstimate);
$('preset').addEventListener('change', () => { $('mask').value = $('preset').value; invalidateEstimate(); });
for (const id of ['target', 'directory-wordlist', 'threads', 'lists']) $(id).addEventListener('input', invalidateCommands);
$('lists').addEventListener('change', updateDownload);
action('estimate', async () => {
  invalidateEstimate(); const mask = $('mask').value; const result = await api('/api/webenum/estimate', {mask});
  if ($('mask').value !== mask) return;
  $('count').textContent = BigInt(result.count_exact).toLocaleString('fr-BE'); $('size').textContent = (result.upper_bytes / 1024 / 1024).toLocaleString('fr-BE', {maximumFractionDigits: 2}) + ' Mio';
  $('preview').textContent = result.preview.join('\n'); $('estimate-result').hidden = false;
  $('limit-note').textContent = result.allowed ? 'Aperçu des premières entrées. Plafonds : 1 000 000 de lignes et 64 Mio. La taille affichée est une borne maximale.' : 'Génération bloquée : plus de 1 000 000 de lignes ou 64 Mio. Réduis le motif.';
  if (result.allowed) { estimatedMask = mask; $('generate').disabled = false; }
  status(result.allowed ? 'Motif prêt à générer.' : 'Cette liste est trop grande.', !result.allowed);
});
action('generate', async () => { const result = await api('/api/webenum/generate', {mask: $('mask').value}); await refreshLists(result.id); status(`${result.lines.toLocaleString('fr-BE')} lignes générées. La liste est prête pour tes commandes.`); });
action('commands', async () => {
  invalidateCommands();
  const request = {list_id: $('lists').value, target: $('target').value, directory_wordlist: $('directory-wordlist').value, threads: Number($('threads').value)};
  const result = await api('/api/webenum/commands', request);
  if (request.list_id !== $('lists').value || request.target !== $('target').value || request.directory_wordlist !== $('directory-wordlist').value || request.threads !== Number($('threads').value)) return;
  for (const key of ['directories', 'files', 'ffuf']) $(key + '-code').textContent = result[key];
  commandText = '# Dossiers\n' + result.directories + '\n\n# Fichiers : Gobuster\n' + result.files + '\n\n# Alternative : ffuf\n' + result.ffuf + '\n';
  $('command-result').hidden = false; status('Commandes prêtes pour le terminal Kali.');
});
document.querySelectorAll('.copy').forEach(button => button.addEventListener('click', async () => { try { await navigator.clipboard.writeText($(button.dataset.copy).textContent); status('Commande copiée.'); } catch { status('Copie indisponible : sélectionne le texte ou télécharge les commandes.', true); } }));
action('download-commands', () => saveBlob('webenum-commandes.txt', commandText, 'text/plain;charset=utf-8'));
action('save', async () => { const name = $('recipe-name').value.trim(); if (!name) throw new Error('Donne un nom à ta recette.'); await api('/api/webenum/estimate', {mask: $('mask').value}); const recipes = readRecipes(); const recipe = {name, mask: $('mask').value}; const index = recipes.findIndex(r => r.name === name); if (index >= 0) recipes[index] = recipe; else recipes.push(recipe); localStorage.setItem(recipeKey, JSON.stringify(recipes)); renderRecipes(); status('Recette enregistrée. Un nom identique remplace la recette précédente.'); });
action('load', () => { if (!$('recipes').value) throw new Error('Choisis une recette.'); const r = readRecipes()[Number($('recipes').value)]; $('mask').value = r.mask; $('recipe-name').value = r.name; invalidateEstimate(); status('Recette chargée. Prévisualise-la pour générer une nouvelle liste.'); });
action('remove', () => { if (!$('recipes').value) throw new Error('Choisis une recette.'); const recipes = readRecipes(); recipes.splice(Number($('recipes').value), 1); localStorage.setItem(recipeKey, JSON.stringify(recipes)); renderRecipes(); status('Recette supprimée.'); });
action('export', () => saveBlob('webenum-recettes.json', JSON.stringify(readRecipes(), null, 2), 'application/json'));
$('import').addEventListener('change', async () => { try { const file = $('import').files[0]; if (!file) return; if (file.size > 65536) throw new Error('Fichier trop grand (maximum 64 Ko).'); const imported = JSON.parse(await file.text()); if (!Array.isArray(imported) || imported.length > 100) throw new Error('Maximum 100 recettes, sous forme de liste JSON.'); for (const r of imported) { if (!r || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 80 || typeof r.mask !== 'string') throw new Error('Recette invalide.'); await api('/api/webenum/estimate', {mask: r.mask}); } const merged = new Map(readRecipes().map(r => [r.name, r])); for (const r of imported) merged.set(r.name, {name:r.name, mask:r.mask}); localStorage.setItem(recipeKey, JSON.stringify([...merged.values()])); renderRecipes(); status('Recettes importées. Les noms identiques ont été remplacés.'); } catch (e) { status(e.message, true); } finally { $('import').value = ''; } });
(async () => { try { const bootstrap = await api('/api/bootstrap'); token = bootstrap.token; renderRecipes(); await refreshLists(); } catch (e) { status(e.message, true); } })();
