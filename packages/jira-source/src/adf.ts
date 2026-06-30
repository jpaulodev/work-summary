export interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
}

/** Convert an Atlassian Document Format body to readable plain text. */
export function adfToText(doc: AdfNode | null | undefined): string {
  if (!doc) return '';
  const out: string[] = [];
  walk(doc, out);
  return out.join('').replace(/\n{3,}/g, '\n\n');
}

function walk(node: AdfNode, out: string[]): void {
  switch (node.type) {
    case 'doc':
      for (const c of node.content ?? []) walk(c, out);
      return;
    case 'paragraph':
    case 'heading':
      for (const c of node.content ?? []) walk(c, out);
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
      for (const c of node.content ?? []) walk(c, out);
      return;
    default:
      for (const c of node.content ?? []) walk(c, out);
  }
}
