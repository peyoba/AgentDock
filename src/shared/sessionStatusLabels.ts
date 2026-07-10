import type { AgentSession } from './agentdockTypes';

const sessionStatusLabels: Record<AgentSession['status'], string> = {
  starting: '启动中',
  running: '运行中',
  stopped: '已停止',
  exited: '已退出',
  interrupted: '已中断',
  failed: '失败',
};

export function sessionStatusLabel(session: AgentSession | undefined): string {
  return session ? sessionStatusLabels[session.status] : '未选择';
}
