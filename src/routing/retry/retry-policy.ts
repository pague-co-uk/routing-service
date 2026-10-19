export interface RetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  multiplier: number;
  maxDelayMs: number;
}

export function retryDelay(policy: RetryPolicy, previousSubmissions: number): number {
  return Math.min(
    policy.maxDelayMs,
    policy.initialDelayMs * policy.multiplier ** (previousSubmissions - 1),
  );
}
