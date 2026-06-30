export interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
}

const MAX_DEPTH = 100;

/** Convert an Atlassian Document Format body to readable plain text. */
export function adfToText(doc: AdfNode | null | undefined): string {
  if (!doc) return '';
  const out: string[] = [];
  walk(doc, out, 0);
  return out.join('').replace(/\n{3,}/g, '\n\n');
}

function walk(node: AdfNode, out: string[], depth: number): void {
  // Guard against pathologically deep ADF trees blowing the call stack.
  if (depth > MAX_DEPTH) return;
  const children = (c: AdfNode): void => walk(c, out, depth + 1);
  switch (node.type) {
    case 'doc':
      for (const c of node.content ?? []) children(c);
      return;
    case 'paragraph':
    case 'heading':
      for (const c of node.content ?? []) children(c);
      out.push('\n\n');
      return;
    case 'text':
      out.push(node.text ?? '');
      return;
    case 'mention': {
      const text =
        typeof node.attrs?.text === 'string'
          ? node.attrs.text
          : typeof node.attrs?.displayName === 'string'
            ? node.attrs.displayName
            : 'user';
      out.push(`@${text.replace(/^@/, '')}`);
      return;
    }
    case 'hardBreak':
      out.push('\n');
      return;
    case 'listItem':
      out.push('- ');
      for (const c of node.content ?? []) children(c);
      return;
    default:
      for (const c of node.content ?? []) children(c);
  }
}
