import { MemoryFs } from '../fs/memoryFs';

const PREFIX = '/samples/demo-workspace/';
const files = import.meta.glob('/samples/demo-workspace/**/*.{json,csv,svg}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export function demoWorkspaceFs(): MemoryFs {
  const contents: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) contents[path.slice(PREFIX.length)] = text;
  return new MemoryFs('demo-workspace', contents, false);
}
