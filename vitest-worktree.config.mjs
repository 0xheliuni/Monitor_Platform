import { defineConfig } from 'vitest/config';
const WT = 'E:/Prod_Project/other/Monitor_Platform/.claude/worktrees/agent-a1327dfb630e7f1a9';
export default defineConfig({
  test: { environment: 'node', include: [WT + '/tests/**/*.test.ts'] },
  resolve: { alias: { '@': WT, 'server-only': WT + '/tests/stubs/server-only.ts' } },
});
