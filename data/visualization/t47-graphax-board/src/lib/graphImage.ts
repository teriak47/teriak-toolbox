// Graph picture export (A6): a standalone SVG of the whole graph, built from the canvas, and
// a PNG drawn from it. The canvas uses CSS variables and classes; the copy gets the
// computed values written on each element, so it looks the same outside the app.

const SVG_NS = 'http://www.w3.org/2000/svg';
const MARGIN = 40;
// Computed properties copied onto every element of the copy
const PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-opacity',
  'stroke-linejoin',
  'stroke-linecap',
  // Labels draw a dark outline under their text: without it the outline covers the letters
  'paint-order',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'color',
];

// Returns the SVG markup of the graph, framed on its content, or null when it is empty.
// `content` is the group that holds the graph (the one moved by the camera).
export function buildGraphSvg(svg: SVGSVGElement, content: SVGGElement, background: string): string | null {
  const box = content.getBBox();
  if (!box.width || !box.height) return null;
  const width = Math.ceil(box.width + MARGIN * 2);
  const height = Math.ceil(box.height + MARGIN * 2);

  const copy = content.cloneNode(true) as SVGGElement;
  // Same structure, so the computed styles can be copied element by element
  const originals = [content, ...content.querySelectorAll('*')];
  const copies = [copy, ...copy.querySelectorAll('*')];
  originals.forEach((el, i) => {
    const target = copies[i] as SVGElement;
    const style = getComputedStyle(el);
    const inline = PROPS.map((p) => {
      const v = style.getPropertyValue(p);
      return v ? `${p}:${v}` : '';
    })
      .filter(Boolean)
      .join(';');
    target.setAttribute('style', inline);
    target.removeAttribute('class');
    // Attributes written with CSS variables (fill="var(--x)") are resolved too
    for (const attr of [...target.attributes]) {
      if (attr.value.includes('var(')) {
        const resolved = attr.name === 'fill' || attr.name === 'stroke' ? style.getPropertyValue(attr.name) : '';
        if (resolved) target.setAttribute(attr.name, resolved);
        else target.removeAttribute(attr.name);
      }
    }
  });
  copy.setAttribute('transform', `translate(${MARGIN - box.x}, ${MARGIN - box.y})`);

  const out = document.createElementNS(SVG_NS, 'svg');
  out.setAttribute('xmlns', SVG_NS);
  out.setAttribute('width', String(width));
  out.setAttribute('height', String(height));
  out.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', background);
  out.appendChild(bg);
  // Markers and gradients referenced by the graph live outside the moved group
  for (const defs of svg.querySelectorAll(':scope > defs')) out.appendChild(defs.cloneNode(true));
  out.appendChild(copy);
  return new XMLSerializer().serializeToString(out);
}

// Draws the SVG on a canvas at `scale` and returns it as a PNG
export async function svgToPng(svgMarkup: string, scale = 2): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([svgMarkup], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Image du graphe illisible.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(img.width * scale);
    canvas.height = Math.ceil(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Dessin impossible dans ce navigateur.');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversion PNG impossible.'))), 'image/png')
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
