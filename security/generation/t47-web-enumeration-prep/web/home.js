'use strict';
(async () => {
  const container = document.getElementById('modules');
  try {
    const response = await fetch('/api/modules');
    if (!response.ok) throw new Error('Catalogue indisponible.');
    const modules = await response.json();
    container.replaceChildren();
    for (const module of modules) {
      const card = document.createElement('a'); card.className = 'module-card'; card.href = module.url;
      const cote = document.createElement('span'); cote.className = 't47-cote'; cote.textContent = module.cote;
      const heading = document.createElement('h3'); heading.textContent = module.title;
      const description = document.createElement('p'); description.textContent = module.description;
      const state = document.createElement('span'); state.className = 'module-state';
      const slit = document.createElement('i'); slit.className = 't47-slit'; slit.setAttribute('aria-hidden','true');
      state.append(slit, document.createTextNode('Disponible'));
      const open = document.createElement('span'); open.className = 'module-open'; open.textContent = 'Ouvrir l’outil →';
      card.append(cote, heading, description, state, open); container.append(card);
    }
  } catch (e) { container.textContent = e.message; }
})();
