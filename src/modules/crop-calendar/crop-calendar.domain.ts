/**
 * Stage-wise crop advice (PRD Learn · crop calendar), written by HO. My Story's
 * "Crop tip" template and the app's crop-calendar screen both read it.
 */
export const CROP_SEASONS = ['kharif', 'rabi', 'zaid'] as const;
export type CropSeason = (typeof CROP_SEASONS)[number];

/** The crop's stable id, e.g. `wheat` — a saved story's `selection.crop_id`. */
export const CROP_KEY = /^[a-z][a-z0-9_]{1,40}$/;

export const MAX_STAGES = 12;
export const MAX_STAGE_PRODUCTS = 10;

export interface CropStage {
  stage: string;
  month: string;
  advice: string;
  /** Product names as farmers know them, e.g. `Zinc EDTA 12%`. */
  products: string[];
}

/** The sentence the HO screen shows, or `null` when the stages are fine. */
export function stagesError(stages: CropStage[]): string | null {
  if (stages.length === 0) return 'Please add at least one crop stage.';
  const seen = new Set<string>();
  for (const [i, s] of stages.entries()) {
    const name = s.stage.trim().toLowerCase();
    if (seen.has(name)) {
      return `Stage ${i + 1} ("${s.stage}") is already in the list. Each stage can be added only once.`;
    }
    seen.add(name);
  }
  return null;
}
