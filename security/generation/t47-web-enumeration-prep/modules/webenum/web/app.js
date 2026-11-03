'use strict';
const $ = id => document.getElementById(id);
let token = '', estimatedMask = '', commandText = '';
const recipeKey = 'webenum-recipes-v1';
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json', 'X-T47-Token': token}, body: JSON.stringify(data)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Action failed.');
  return result;
}
function action(id, fn) { $(id).addEventListener('click', async () => { $(id).disabled = true; try { await fn(); } catch (e) { status(e.message, true); } finally { $(id).disabled = id === 'generate' ? estimatedMask !== $('mask').value : false; } }); }
function invalidateEstimate() { estimatedMask = ''; $('generate').disabled = true; $('estimate-result').hidden = true; }
function invalidateCommands() { $('command-result').hidden = true; commandText = ''; }
function saveBlob(name, text, type) { const url = URL.createObjectURL(new Blob([text], {type})); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function readRecipes() { const parsed = JSON.parse(localStorage.getItem(recipeKey) || '[]'); if (!Array.isArray(parsed)) throw new Error('Invalid recipes.'); return parsed; }
function renderRecipes() { const select = $('recipes'); select.replaceChildren(new Option('My recipes', '')); readRecipes().forEach((r, i) => select.add(new Option(r.name, String(i)))); }
function updateDownload() { const id = $('lists').value; $('download').hidden = !id; $('download').href = '/download/webenum/' + id; invalidateCommands(); }
async function refreshLists(selected) { const lists = await api('/api/webenum/lists'); $('lists').replaceChildren(new Option('Choose a list', '')); for (const item of lists) $('lists').add(new Option(`${item.mask} · ${item.lines.toLocaleString('en-US')} lines · ${item.id.slice(0,8)}`, item.id)); if (selected) $('lists').value = selected; updateDownload(); }
$('mask').addEventListener('input', invalidateEstimate);
$('preset').addEventListener('change', () => { $('mask').value = $('preset').value; invalidateEstimate(); });
for (const id of ['target', 'directory-wordlist', 'threads', 'lists']) $(id).addEventListener('input', invalidateCommands);
$('lists').addEventListener('change', updateDownload);
action('estimate', async () => {
  invalidateEstimate(); const mask = $('mask').value; const result = await api('/api/webenum/estimate', {mask});
  if ($('mask').value !== mask) return;
  $('count').textContent = BigInt(result.count_exact).toLocaleString('en-US');
  const size = result.upper_bytes;
  $('size').textContent = size < 1024 ? `${size.toLocaleString('en-US')} B` : size < 1024 * 1024
    ? `${(Math.ceil(size / 1024 * 100) / 100).toLocaleString('en-US')} KiB`
    : `${(Math.ceil(size / (1024 * 1024) * 100) / 100).toLocaleString('en-US')} MiB`;
  $('preview').textContent = result.preview.join('\n'); $('estimate-result').hidden = false;
  $('limit-note').textContent = result.allowed ? 'First entries shown. Limits: 1,000,000 lines and 64 MiB. The reported size is an upper bound.' : 'Generation blocked: more than 1,000,000 lines or 64 MiB. Reduce the pattern.';
  if (result.allowed) { estimatedMask = mask; $('generate').disabled = false; }
  status(result.allowed ? 'Pattern is ready to generate.' : 'This list is too large.', !result.allowed);
});
action('generate', async () => { const result = await api('/api/webenum/generate', {mask: $('mask').value}); await refreshLists(result.id); status(`${result.lines.toLocaleString('en-US')} lines generated. The list is ready for your commands.`); });
action('commands', async () => {
  invalidateCommands();
  const request = {list_id: $('lists').value, target: $('target').value, directory_wordlist: $('directory-wordlist').value, threads: Number($('threads').value)};
  const result = await api('/api/webenum/commands', request);
  if (request.list_id !== $('lists').value || request.target !== $('target').value || request.directory_wordlist !== $('directory-wordlist').value || request.threads !== Number($('threads').value)) return;
  for (const key of ['directories', 'files', 'ffuf']) $(key + '-code').textContent = result[key];
  commandText = '# Directories\n' + result.directories + '\n\n# Files: Gobuster\n' + result.files + '\n\n# Alternative: ffuf\n' + result.ffuf + '\n';
  $('command-result').hidden = false; status('Commands are ready for the Kali terminal.');
});
document.querySelectorAll('.copy').forEach(button => button.addEventListener('click', async () => { try { await navigator.clipboard.writeText($(button.dataset.copy).textContent); status('Command copied.'); } catch { status('Copy unavailable: select the text or download the commands.', true); } }));
action('download-commands', () => saveBlob('webenum-commands.txt', commandText, 'text/plain;charset=utf-8'));
action('save', async () => { const name = $('recipe-name').value.trim(); if (!name) throw new Error('Enter a recipe name.'); await api('/api/webenum/estimate', {mask: $('mask').value}); const recipes = readRecipes(); const recipe = {name, mask: $('mask').value}; const index = recipes.findIndex(r => r.name === name); if (index >= 0) recipes[index] = recipe; else recipes.push(recipe); localStorage.setItem(recipeKey, JSON.stringify(recipes)); renderRecipes(); status('Recipe saved. A matching name replaces the previous recipe.'); });
action('load', () => { if (!$('recipes').value) throw new Error('Choose a recipe.'); const r = readRecipes()[Number($('recipes').value)]; $('mask').value = r.mask; $('recipe-name').value = r.name; invalidateEstimate(); status('Recipe loaded. Preview it to generate a new list.'); });
action('remove', () => { if (!$('recipes').value) throw new Error('Choose a recipe.'); const recipes = readRecipes(); recipes.splice(Number($('recipes').value), 1); localStorage.setItem(recipeKey, JSON.stringify(recipes)); renderRecipes(); status('Recipe deleted.'); });
action('export', () => saveBlob('webenum-recipes.json', JSON.stringify(readRecipes(), null, 2), 'application/json'));
$('import').addEventListener('change', async () => { try { const file = $('import').files[0]; if (!file) return; if (file.size > 65536) throw new Error('File too large (maximum 64 KiB).'); const imported = JSON.parse(await file.text()); if (!Array.isArray(imported) || imported.length > 100) throw new Error('A JSON list may contain at most 100 recipes.'); for (const r of imported) { if (!r || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 80 || typeof r.mask !== 'string') throw new Error('Invalid recipe.'); await api('/api/webenum/estimate', {mask: r.mask}); } const merged = new Map(readRecipes().map(r => [r.name, r])); for (const r of imported) merged.set(r.name, {name:r.name, mask:r.mask}); localStorage.setItem(recipeKey, JSON.stringify([...merged.values()])); renderRecipes(); status('Recipes imported. Existing recipes with the same name were replaced.'); } catch (e) { status(e.message, true); } finally { $('import').value = ''; } });
(async () => { try { const bootstrap = await api('/api/bootstrap'); token = bootstrap.token; renderRecipes(); await refreshLists(); } catch (e) { status(e.message, true); } })();
