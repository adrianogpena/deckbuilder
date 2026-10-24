export type KubeErrorCode =
  | 'azureLogin'
  | 'credentialsRejected'
  | 'forbidden'
  | 'notfound'
  | 'unreachable'
  | 'timeout'
  | 'missingBinary'
  | 'raw';

export interface KubeError {
  code: KubeErrorCode;
  message: string;
}

// Ordered: the first matching rule wins. Azure token failures often also mention "Unauthorized" or "forbidden".
const RULES: Array<{ code: KubeErrorCode; test: RegExp; message: string }> = [
  { code: 'missingBinary', test: /is not recognized as an internal or external command|command not found/i, message: 'Program not found in PATH (for AKS clusters, install the Azure CLI "az").' },
  { code: 'azureLogin', test: /az login|AADSTS|kubelogin|devicelogin|AzureCLICredential|refresh token|token (has )?expired|interactive (login|authentication)/i, message: 'Azure session expired or not logged in. Run "az login" in a terminal and retry.' },
  { code: 'credentialsRejected', test: /Unauthorized|You must be logged in|provide credentials|getting credentials/i, message: 'The cluster rejected the credentials. Log in again or check your kubeconfig.' },
  { code: 'forbidden', test: /forbidden|cannot (list|get|watch|patch|delete|create)/i, message: 'Your user is not allowed to perform this operation on this cluster.' },
  { code: 'notfound', test: /NotFound|not found|doesn't have a resource type/i, message: 'Resource not found.' },
  { code: 'timeout', test: /timed out|timeout/i, message: 'The cluster did not answer in time.' },
  { code: 'unreachable', test: /Unable to connect|connection refused|no such host|i\/o timeout|dial tcp|context deadline exceeded|TLS handshake timeout|Bad Gateway|Service Unavailable|EOF$/im, message: 'Could not reach the cluster. Is it running and reachable from this machine?' },
];

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  return line.replace(/^error:\s*/i, '').slice(0, 300);
}

export function classifyStderr(stderr: string): KubeError {
  const text = stderr.trim();
  for (const rule of RULES) if (rule.test.test(text)) return { code: rule.code, message: rule.message };
  return { code: 'raw', message: firstLine(text) || 'The command failed without a message.' };
}
