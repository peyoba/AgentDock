import type { AgentSession, Workspace } from '../shared/agentdockTypes.js';
import type { SessionSummaryStore } from './sessionSummaryStore.js';
import { redactSummarySecrets, validateSummaryMarkdown } from './sessionSummaryStore.js';

type Clock = {
  now(): Date;
};

export type SummaryRunnerInput = {
  session: AgentSession;
  workspace: Workspace;
  previousSummary?: string;
  redactedTranscriptTail: string;
  generatedAt: string;
  summaryProviderProfileId: string;
};

export type SummaryRunner = (input: SummaryRunnerInput) => Promise<string>;

export type SummaryContinuationLauncher = (input: {
  sourceSession: AgentSession;
  handoffPrompt: string;
}) => Promise<AgentSession>;

export type SummaryJobService = {
  summarizeSession(request: SummaryJobRequest): Promise<SummaryJobResult>;
};

export type SummaryJobRequest = {
  session: AgentSession;
  workspace: Workspace;
  continueAfterSummary: boolean;
  summaryProviderProfileId?: string;
};

export type SummaryJobResult = {
  status: 'success';
  summaryFile: string;
  handoffFile: string;
  handoffPrompt: string;
  continuationSession?: AgentSession;
};

type CreateSummaryJobServiceOptions = {
  summaryStore: SessionSummaryStore;
  runSummary?: SummaryRunner;
  readTranscript: (input: { session: AgentSession; workspace: Workspace }) => Promise<string>;
  launchContinuation?: SummaryContinuationLauncher;
  clock?: Clock;
  transcriptTailBytes?: number;
};

const DEFAULT_TRANSCRIPT_TAIL_BYTES = 120_000;
const defaultClock: Clock = { now: () => new Date() };

async function unavailableSummaryRunner(): Promise<string> {
  throw new Error('总结器尚不可用，请稍后配置真实 CLI runner');
}

export function createSummaryJobService({
  summaryStore,
  runSummary = unavailableSummaryRunner,
  readTranscript,
  launchContinuation,
  clock = defaultClock,
  transcriptTailBytes = DEFAULT_TRANSCRIPT_TAIL_BYTES,
}: CreateSummaryJobServiceOptions): SummaryJobService {
  return {
    async summarizeSession({
      session,
      workspace,
      continueAfterSummary,
      summaryProviderProfileId = session.profileId,
    }: SummaryJobRequest): Promise<SummaryJobResult> {
      const previousSummary = await summaryStore.readLatestSummary({
        workspacePath: workspace.path,
        sessionId: session.id,
      });
      const transcript = await readTranscript({ session, workspace });
      const redactedTranscriptTail = tailByBytes(
        redactSummarySecrets(transcript),
        transcriptTailBytes,
      );
      const summaryMarkdown = await runSummary({
        session: { ...session },
        workspace: { ...workspace },
        previousSummary: previousSummary?.summaryMarkdown,
        redactedTranscriptTail,
        generatedAt: clock.now().toISOString(),
        summaryProviderProfileId,
      });
      const validation = validateSummaryMarkdown(summaryMarkdown);
      if (!validation.ok) {
        throw new Error(validation.reason);
      }

      const { summaryFile, handoffFile } = await summaryStore.writeSummary({
        workspacePath: workspace.path,
        sessionId: session.id,
        summaryMarkdown,
        handoffMarkdown: summaryMarkdown,
      });
      const handoffPrompt = [
        'Read the AgentDock handoff first, then continue the task:',
        handoffFile,
      ].join('\n');
      const continuationSession =
        continueAfterSummary && launchContinuation
          ? await launchContinuation({ sourceSession: session, handoffPrompt })
          : undefined;

      return {
        status: 'success',
        summaryFile,
        handoffFile,
        handoffPrompt,
        continuationSession,
      };
    },
  };
}

function tailByBytes(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf-8');
  if (bytes.length <= maxBytes) {
    return value;
  }

  return bytes.subarray(bytes.length - maxBytes).toString('utf-8');
}
