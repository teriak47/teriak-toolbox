# Opération Chimère — Enquête Cyber & Intrusion

Analyse croisée d'une compromission supply-chain : corrélation d'infrastructures C2, artefacts malveillants, acteurs menaçants et hypothèses d'attribution.

*Rapport Graphax du 5 novembre 2026 : 7 nœuds, 8 liens.*

## Acteur malveillant (1)

### Groupe "NightOwl" (APT-X)

**Fiabilité :** B2 (Habituellement fiable · Probablement vraie)

| Attribut | Valeur |
| --- | --- |
| Origine | Cluster Est-Européen |
| Statut | Actif |

> ### Profil de menace
> Groupe observé depuis **fin 2025** ciblant des dépôts CI/CD.
>
> - Réutilisation de certificats auto-signés spécifiques
> - Fenêtres d'activité : `06:00 - 15:00 UTC`
> - TTPs proches d'anciennes campagnes *ShadowLoader*.

## Malware / Outil (1)

### Implant "ChimeraLoader.dll"

**Fiabilité :** A1 (Totalement fiable · Confirmée par d’autres sources)

| Attribut | Valeur |
| --- | --- |
| Famille | ChimeraLoader |
| Langage | Rust / C++ |
| SHA-256 | 9f86d081884c7d659a2f... |

> ### Analyse statique
> DLL injectée par *side-loading* lors de l'étape de build.
>
> ```text
> Mutex: Global\Chm_Sync_991
>  Sleep jitter: 45s ± 30%
> ```
> Exfiltre les variables d'environnement chiffrées en ChaCha20.

## IP / Serveur (1)

### Relais C2 192.0.2.42

**Fiabilité :** A1 (Totalement fiable · Confirmée par d’autres sources)

| Attribut | Valeur |
| --- | --- |
| ASN | AS205100 |
| IP | 192.0.2.42 |
| Port | 8443 / TLS 1.3 |

> ### Télémétrie Réseau
> Noeud relais contacté toutes les 45 secondes par `ChimeraLoader.dll`.
>
> - Certificat TLS émis le `2026-10-14`
> - Hébergeur VPS payé en Monero selon réponse réquisition.

## Domaine / URL (1)

### telemetry[.]example

| Attribut | Valeur |
| --- | --- |
| Création | 2026-09-29 |
| Domaine | telemetry.example |
| Registrar | NameCheap |

> Domaine de *fallback* codé en dur dans la configuration chiffrée du loader.
> Pointe vers `192.0.2.42` via enregistrement A.

## Organisation / Victime (1)

### NovaTech CI/CD Pipeline

| Attribut | Valeur |
| --- | --- |
| Date | 2026-10-22 |
| Impact | Critique |
| Périmètre | Runner Build #04 |

> ### Point d'entrée initial
> Compromission d'un token de publication secondaire ayant permis l'injection de `ChimeraLoader.dll` dans la release `v4.2.1`.

## Preuve / Rapport (1)

### Logs Forensics Runner #04

**Fiabilité :** A1 (Totalement fiable · Confirmée par d’autres sources)

| Attribut | Valeur |
| --- | --- |
| Horodatage | 2026-10-22 08:14 UTC |
| Source | EDR + Auditd |

> Capture mémoire et journaux système confirmant l'exécution du binaire malveillant et la connexion sortante vers `192.0.2.42:8443`.

## Hypothèse (1)

### Phishing DevOps ou Fuite Token ?

| Attribut | Valeur |
| --- | --- |
| Priorité | Haute |
| Statut | En vérification |

> ### Hypothèse de travail
> Le token CI/CD n'avait pas expiré malgré la politique de rotation à 30 jours.
>
> 1. **Piste A :** Spear-phishing d'un ingénieur DevOps le 18/10.
> 2. **Piste B :** Fuite involontaire dans un dépôt public forké.

## Liens

| De | Relation | Vers | Nature |
| --- | --- | --- | --- |
| Logs Forensics Runner #04 | documente intrusion | NovaTech CI/CD Pipeline | Fait |
| Groupe "NightOwl" (APT-X) | vecteur supposé | Phishing DevOps ou Fuite Token ? | Hypothèse |
| Implant "ChimeraLoader.dll" | domaine de secours | telemetry[.]example | Fait |
| Groupe "NightOwl" (APT-X) | développe probable | Implant "ChimeraLoader.dll" | Hypothèse |
| Implant "ChimeraLoader.dll" | communique avec (TLS) | Relais C2 192.0.2.42 | Fait |
| telemetry[.]example | résout vers (DNS A) | Relais C2 192.0.2.42 | Fait |
| Phishing DevOps ou Fuite Token ? | explique accès initial ? | NovaTech CI/CD Pipeline | Hypothèse |
| NovaTech CI/CD Pipeline | infecté par | Implant "ChimeraLoader.dll" | Fait |
