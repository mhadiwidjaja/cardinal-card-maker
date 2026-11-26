/**
 * Colour-blindness simulation for the card preview. Only the on-screen
 * preview is filtered; the renderer and every export stay unchanged.
 *
 * The matrices are Machado, Oliveira and Fernandes (2009), "A Physiologically-
 * based Model for Simulation of Color Vision Deficiency", at severity 1.0.
 * SVG's feColorMatrix works in linear RGB by default, which is what the
 * model expects.
 */

import { VISION_LABELS, VISION_MATRICES as MATRICES, type Matrix3, type Vision } from '../model/colourVision';

export type { Vision };

export const VISION_FILTERS: Record<Vision, { label: string; css: string | undefined }> = {
  normal: { label: VISION_LABELS.normal, css: undefined },
  protan: { label: VISION_LABELS.protan, css: 'url(#cm-vision-protan)' },
  deutan: { label: VISION_LABELS.deutan, css: 'url(#cm-vision-deutan)' },
  tritan: { label: VISION_LABELS.tritan, css: 'url(#cm-vision-tritan)' },
  grey: { label: VISION_LABELS.grey, css: 'url(#cm-vision-grey)' },
};

export function colorMatrixValues(m: Matrix3): string {
  const row = (a: number, b: number, c: number) => `${a} ${b} ${c} 0 0`;
  return [row(m[0], m[1], m[2]), row(m[3], m[4], m[5]), row(m[6], m[7], m[8]), '0 0 0 1 0'].join('  ');
}

export function VisionFilterDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        {(Object.keys(MATRICES) as (keyof typeof MATRICES)[]).map((id) => (
          <filter key={id} id={`cm-vision-${id}`}>
            <feColorMatrix type="matrix" values={colorMatrixValues(MATRICES[id])} />
          </filter>
        ))}
      </defs>
    </svg>
  );
}
