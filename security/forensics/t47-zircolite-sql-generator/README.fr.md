# T47 Zircolite SQL Generator

🌐 **Langue :** [English](README.md) | Français

Double-cliquer sur **index.html**. L’interface est en anglais. Cet outil local fonctionne sans installation, fichier de données à charger, serveur ni accès réseau automatique.

1. Choisir un modèle et remplir les critères visibles.
2. Lire l'explication et le périmètre affichés.
3. Copier le SQL, le coller dans **Zircolite Viewer → SQL**, puis exécuter dans le Viewer.
4. Pour les requêtes d'événements, ouvrir un lien `_zl_uid` et récupérer le JSON dans le Viewer.

L'exemple intégré utilise des valeurs fictives. Il illustre le fonctionnement et ne constitue pas une conclusion d'investigation.

## Modèles

- Synthèse des accès Security 5145 par compte, IP et partage, avec nombre de chemins distincts.
- Synthèse des règles déclenchées, par titre, niveau et machine.
- Événements d'une règle, titre exact ou recherche littérale dans le titre.
- Lancement, enfants directs, créations de fichiers, réseau et DNS d'un processus Sysmon suivi par GUID.
- Authentifications Security 4624 et 4625, IP source facultative.
- Événement précis par machine, canal, EventID et EventRecordID.

Les heures sont saisies directement en **UTC**. Début inclus et fin exclue. Le changement de modèle efface les bornes horaires pour éviter de masquer une création de processus antérieure ; le formulaire montre toujours le périmètre actif. Une limite explicite borne le nombre de lignes, sans garantir qu'un résultat soit exhaustif.

## Périmètre technique

- Un seul fichier HTML avec CSS et JavaScript intégrés ; aucune dépendance externe.
- Ne lit pas les logs, n'exécute pas le SQL, ne crée pas de CSV, ne sauvegarde pas les saisies.
- Produit uniquement des SELECT sur les tables documentées `events`, `hits`, `rules` du **Viewer**, pas sur la table `logs` du moteur CLI.
- Les valeurs sont échappées ; noms de tables et de colonnes fixés par les modèles. Les apostrophes, `%` et `_` sont traités littéralement dans les critères, sans laisser saisir du SQL libre.
- Pas de `to_json`, d'extension à installer ni de commande de modification de base.
- Les champs de chaque modèle doivent exister dans le package. En cas de colonne inconnue, vérifier les colonnes dans **SQL → Tables** ; l'outil ne peut pas découvrir le schéma d'un package qu'il ne lit pas.
- Aucun résultat ne signifie aucune correspondance dans les données chargées et le périmètre choisi ; pas une preuve générale d'absence d'activité.
- Les alias SQL produits sont en anglais ; les scripts qui utilisaient les anciens alias français doivent être adaptés.
- Les polices SECTION 21 sont utilisées si elles sont installées localement ; sinon, l’outil utilise les polices du système, sans téléchargement.

## Tests

Avec Node.js 22 ou plus récent, exécuter `node --test tests/*.test.cjs` dans ce dossier. Pour exécuter les requêtes sur des tables DuckDB fictives en mémoire, installer les dépendances de test avec `python -m pip install -r requirements-test.txt`, puis exécuter `python -m unittest discover -s tests -p 'test_*.py' -v`. Node.js, Python et DuckDB servent uniquement aux tests, pas à l’utilisation de l’outil. Ces vérifications ne remplacent pas un test dans Zircolite Viewer.

Source : [documentation officielle Zircolite Viewer](https://github.com/wagga40/Zircolite/blob/master/docs/Viewer.md).

## Licence

Cet outil fait partie de Teriak Toolbox et est distribué sous la licence GPL v3 du dépôt.
