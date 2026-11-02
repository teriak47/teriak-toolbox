import { MediaType, RatingCriterion, Scores } from '../types';

const TYPE_MAPPING: { [key in MediaType]: string } = {
  [MediaType.SERIES]: 'Série-TV',
  [MediaType.MOVIES]: 'Film',
  [MediaType.BOOKS]: 'Livre',
  [MediaType.MUSIC]: 'Musique',
  [MediaType.ANIME]: 'Animé',
};

/** Barre de progression textuelle sur 7 crans (rendu net dans Obsidian). */
const scoreBar = (score: number): string => '█'.repeat(score) + '░'.repeat(7 - score);

export const formatForObsidian = (
  scores: Scores,
  criteria: RatingCriterion[],
  mediaTitle: string,
  mediaType: MediaType,
  coverImage = ''
): string => {
  const title = mediaTitle.trim() || 'Sans titre';
  const yamlType = TYPE_MAPPING[mediaType] || mediaType;
  const date = new Date().toISOString().slice(0, 10);

  const ratedCriteria = criteria.filter((c) => c.score > 0);
  const hasCustomWeights = ratedCriteria.some((c) => c.weight !== 1);

  const frontmatter = `---
type:
  - ${yamlType}
note: ${scores.avg10Point}
note_originale: ${scores.avg7Point}
date: ${date}
${coverImage.trim() ? `image_cover: ${JSON.stringify(coverImage.trim())}\n` : ''}tags:
aliases:
---`;

  const infoBlock = `> [!info] Fiche
> - **Type**:: ${mediaType}
> - **Noté le**:: ${date}
> - **Note**:: ${scores.avg10Point} / 10`;

  const scoresTable = `| Échelle | /7 | /10 | /5 |
| --- | ---: | ---: | ---: |
| Note | **${scores.avg7Point}** | **${scores.avg10Point}** | **${scores.avg5Point}** |`;

  const criteriaHeader = hasCustomWeights
    ? `| Critère | Note | Poids | |
| --- | ---: | ---: | --- |`
    : `| Critère | Note | |
| --- | ---: | --- |`;

  const criteriaRows = ratedCriteria
    .map((c) =>
      hasCustomWeights
        ? `| ${c.label} | ${c.score}/7 | ×${c.weight} | \`${scoreBar(c.score)}\` |`
        : `| ${c.label} | ${c.score}/7 | \`${scoreBar(c.score)}\` |`
    )
    .join('\n');

  const methodNote =
    ratedCriteria.length < criteria.length
      ? `\n> [!note]- Méthode\n> Moyenne pondérée sur ${ratedCriteria.length} critère(s) noté(s) sur ${criteria.length} — les critères non notés sont ignorés.`
      : '';

  return `${frontmatter}

# ${title}

${infoBlock}

## Ma note

${scoresTable}

### Critères

${criteriaHeader}
${criteriaRows}
${methodNote}

## Avis

—

---

> [!seealso] Voir aussi
> - `;
};

export const sanitizeFilename = (title: string): string =>
  title.trim().toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'note';

export const downloadMarkdown = (filename: string, content: string): void => {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = `${filename}.md`;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(url);
  a.remove();
};
