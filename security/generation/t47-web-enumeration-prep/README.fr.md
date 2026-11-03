# T47 Web Enumeration Prep

🌐 **Langue :** [English](README.md) | Français

Cet outil prépare des dictionnaires de fichiers et des commandes
Gobuster/ffuf à copier. Son interface est en anglais et l’application n’exécute aucun scan.

## Démarrer

Ouvre un terminal dans le dossier de l’outil, puis lance :

```bash
python3 app.py
```

Ouvre **http://127.0.0.1:8765** sur la même machine. Python **3.10+** suffit,
sans dépendance Python à installer. Ctrl+C arrête le serveur.

```bash
python3 app.py --port 8766
```

L’accueil permet d’ouvrir **Web Enumeration**, le module précédemment nommé
WebEnum. L’interface reste toujours sombre.
Le logo, les styles SECTION 21 et les polices sont locaux : aucun accès
Internet n’est requis pour l’affichage. Les licences des fontes sont jointes.

## Énumération web

1. Choisir ou écrire un motif, puis prévisualiser les noms et le nombre de combinaisons.
2. Générer le fichier `.txt` : il est conservé dans `data/webenum/`.
3. Renseigner l’URL HTTP(S), le port et le dictionnaire de dossiers présent sur Kali.
4. Copier la commande de découverte des dossiers dans le terminal.
5. Examiner les résultats, remplacer l’URL par celle du dossier retenu et recréer
   les commandes pour rechercher les fichiers.
6. Vérifier les ressources découvertes ; une réponse HTTP 200 peut aussi être
   une page d’erreur générique. L’application ne trie pas les réponses des scanners.

Le chemin `/usr/share/wordlists/dirb/common.txt` est un point de départ à vérifier
sur la machine. Gobuster et ffuf sont requis seulement pour exécuter leurs commandes
dans le terminal. Vérifier les options avec `gobuster dir --help` et `ffuf -h`.
Les commandes utilisent les chemins du serveur : si l’outil tourne sur une autre
machine que Kali, transférer les listes et adapter leurs chemins. Les noms contiennent
déjà l’extension, sans ajouter `-x pdf`.
Chaque commande utilise GNU `mktemp` pour créer un nouveau fichier de résultats et
affiche son chemin. Une exécution interrompue peut laisser un fichier vide.

Les motifs proposés sont des exemples ; renseigne la cible réellement utilisée.

| Bloc | Résultat |
| --- | --- |
| `{digits:4}` | 0000 à 9999 |
| `{lower:2-3}` | minuscules, longueur 2 puis 3 |
| `{upper:2}` | majuscules, longueur 2 |
| `{hex:4}` | alphabet 0123456789abcdef |
| `{alnum:3}` | minuscules et chiffres |
| `{range:2020:2026}` | nombres 2020 à 2026 inclus |
| `{range:1:31:2}` | 01 à 31, largeur minimale 2 |
| `{words:public,interne,final}` | les trois mots dans cet ordre |
| `{chars:abc123:2}` | deux caractères de cet alphabet |

Exemples : `rapport-{digits:4}.pdf` ou
`rapport-{range:2024:2026}-{range:1:12:2}.pdf`.

Les étoiles sont littérales, pas des inconnues. Les chemins, accolades imbriquées
et caractères de contrôle sont refusés. Les doublons d’un alphabet ou bloc de mots
sont supprimés ; il n’y a pas de déduplication globale entre combinaisons de blocs.
Utiliser des séparateurs ou longueurs fixes pour éviter les ambiguïtés.

Les listes sont déterministes, UTF-8, une entrée par ligne, fins de ligne Linux.
La génération est progressive et limitée à 1 000 000 de lignes et 64 Mio par liste.
La taille annoncée est une borne maximale. Les recettes sont enregistrées dans
le navigateur sous la même clé que WebEnum ; elles restent disponibles si l’origine
(adresse et port) est conservée. Exporter/importer le JSON pour les transférer.
Un nom de recette identique remplace la précédente.

Les listes survivent au redémarrage dans `data/webenum/`. Copier ce dossier entier
pour transférer les listes. Pour les supprimer manuellement, arrêter le serveur
et supprimer ensemble le `.txt` et le `.json` portant le même identifiant.

## Architecture

- `app.py` : serveur local, session, assets communs et distribution des requêtes.
- `web/` : accueil, catalogue des modules et identité SECTION 21 commune.
- `modules/__init__.py` : registre explicite des outils.
- `modules/webenum/` : logique et interface du premier module.
- `data/<module>/` : données propres à chaque outil.
- `tests/` : vérifications du générateur et de l’API HTTP.

Les pages vivent sous `/tools/<nom>/`, les API sous `/api/<nom>/`, les assets
communs sous `/assets/`. Les actions POST portent le jeton `X-T47-Token` obtenu
avec `/api/bootstrap`. Aucun module n’est chargé depuis un fichier utilisateur
ou un plug-in téléchargé.

## Vérifier

```bash
python3 -m unittest discover -s tests -v
```

## Licence

Web Enumeration Prep fait partie de Teriak Toolbox sous licence GPL v3. Les polices intégrées conservent leurs licences OFL respectives.
