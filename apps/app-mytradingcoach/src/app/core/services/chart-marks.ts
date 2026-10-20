/** Repères dessinés par-dessus les courbes (lignes de seuil, pastilles libellées). */

/** `#10b981` → `rgba(16,185,129,a)` (les tokens sémantiques sont en hex). */
export function alpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export interface MarkArea {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Ligne horizontale (pointillée ou pleine) et libellé calé à droite, au-dessus de la ligne, ou
 * dessous si elle colle au haut de la zone.
 */
export function drawLevel(
  ctx: CanvasRenderingContext2D,
  area: MarkArea,
  y: number,
  o: { stroke?: string; color: string; label: string; fontSize: number; dashed?: boolean; below?: boolean },
): void {
  const ly = Math.round(y) + 0.5;
  if (o.stroke) {
    ctx.strokeStyle = o.stroke;
    ctx.setLineDash(o.dashed === false ? [] : [4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(area.left, ly);
    ctx.lineTo(area.right, ly);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = o.color;
  ctx.textAlign = 'right';
  // `below` : libellé sous la ligne (plancher : sous la ligne, dans la zone teintée).
  const below = (o.below && ly + o.fontSize + 4 <= area.bottom) || ly - o.fontSize - 4 < area.top;
  ctx.textBaseline = below ? 'top' : 'bottom';
  ctx.fillText(o.label, area.right, below ? ly + 4 : ly - 4);
}

/**
 * Pastille sur la courbe + libellé : à droite si la place le permet, sinon à gauche ; au-dessus,
 * ou dessous si demandé ou si la pastille colle au haut de la zone.
 */
export function drawPin(
  ctx: CanvasRenderingContext2D,
  area: MarkArea,
  pt: { x: number; y: number },
  o: { fill: string; ring: string; color: string; label: string; fontSize: number; below?: boolean },
): void {
  ctx.fillStyle = o.fill;
  ctx.strokeStyle = o.ring;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const w = ctx.measureText(o.label).width;
  if (o.below) {
    // Centré sous la pastille, sans sortir de la zone.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = o.color;
    const cx = Math.min(Math.max(pt.x, area.left + w / 2), area.right - w / 2);
    ctx.fillText(o.label, cx, Math.min(pt.y + 8, area.bottom - o.fontSize));
    return;
  }
  const toRight = pt.x + 8 + w <= area.right;
  ctx.textAlign = toRight ? 'left' : 'right';
  const lx = toRight ? pt.x + 8 : Math.max(area.left + w, pt.x - 8);
  const below = pt.y - o.fontSize - 6 < area.top;
  ctx.textBaseline = below ? 'top' : 'bottom';
  const ly = below ? Math.min(pt.y + 6, area.bottom - o.fontSize) : pt.y - 6;
  ctx.fillStyle = o.color;
  ctx.fillText(o.label, lx, ly);
}
