import { EventEmitter } from 'node:events';

const bus = new EventEmitter();

// SEED: Memory leak via unbounded listener attachment in request loop
export function handleIncomingRequest(requestId: string): void {
  // Violation: new listener attached on global bus for every call without removeListener
  bus.on('event', (data) => {
    console.log(`Handled ${requestId}:`, data);
  });
}

// SEED: N+1 query pattern in loop
export async function fetchUsersWithProfiles(userIds: string[], fetchProfileFn: (id: string) => Promise<any>): Promise<any[]> {
  const results = [];
  // Violation: per-item fetch creates N individual queries instead of batch fetch
  for (const id of userIds) {
    const profile = await fetchProfileFn(id);
    results.push(profile);
  }
  return results;
}
