// Names a log source gives its subagents (Codex's agent_nickname: "Euclid"), by the agent's id, for the agents module.
// Claude Code names its subagents in a meta file next to their log; Codex says the name in the log's first line.
const names = new Map<string, string>();
const MAX = 2_000;

export function setAgentName(agentId: string, name: string) {
  names.delete(agentId);
  names.set(agentId, name);
  if (names.size > MAX) names.delete(names.keys().next().value!);
}

export const agentName = (agentId: string): string | undefined => names.get(agentId);
