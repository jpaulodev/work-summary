import { describe, it, expect } from 'vitest';
import { adfToText } from './adf.js';

describe('adfToText', () => {
  it('handles paragraphs and text', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second line' }] },
      ],
    };
    expect(adfToText(doc).trim()).toBe('Hello world\n\nSecond line');
  });

  it('renders mentions as @name', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'cc ' },
            { type: 'mention', attrs: { text: '@jpaulo', id: 'u1' } },
          ],
        },
      ],
    };
    expect(adfToText(doc).trim()).toBe('cc @jpaulo');
  });

  it('ignores unknown leaf nodes', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'A ' },
            { type: 'emoji', attrs: { shortName: ':smile:' } },
            { type: 'text', text: ' B' },
          ],
        },
      ],
    };
    expect(adfToText(doc).trim()).toBe('A  B');
  });

  it('returns empty string for null/undefined', () => {
    expect(adfToText(null)).toBe('');
    expect(adfToText(undefined)).toBe('');
  });
});
