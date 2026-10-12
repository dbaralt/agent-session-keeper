import type { AgentAdapter } from '../../../src/agents/AgentAdapter';

/** A minimal adapter for correlator tests; cwd matching uses the info header. */
export function createStubAdapter(id = 'claude'): AgentAdapter {
  return {
    id,
    displayName: id,
    icon: 'sparkle',
    supportsPresetId: true,
    defaultPatterns: [id],
    matchCommand(argv) {
      return argv[0] === id ? { interactive: true, isResume: false } : undefined;
    },
    sessionRoots: () => [],
    isSessionFile: (filePath) => filePath.endsWith('.jsonl'),
    readSessionFile: async () => undefined,
    fileBelongsToCwd: (_filePath, info, cwd) => (info.cwd ?? cwd) === cwd,
    transcriptPathFor: async () => undefined,
    buildNewCommand: () => id,
    buildResumeCommand: (record) => `${id} --resume ${record.sessionId}`,
  };
}
