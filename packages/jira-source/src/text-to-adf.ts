import type { AdfNode } from './adf.js';

export interface AdfDoc {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

/** Convert plain text into a minimal ADF document (one paragraph per non-empty line). */
export function textToAdf(text: string): AdfDoc {
  const lines = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    type: 'doc',
    version: 1,
    content:
      lines.length === 0
        ? [{ type: 'paragraph', content: [] }]
        : lines.map((line) => ({
            type: 'paragraph',
            content: [{ type: 'text', text: line }],
          })),
  };
}
