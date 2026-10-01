// SEED: Off-by-one boundary error (CWE-193)
export function getPageItems<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize;
  // Vulnerable: off-by-one using <= instead of <, returning 1 item too many
  const end = start + pageSize + 1;
  return items.slice(start, end);
}

// SEED: Unhandled concurrent mutation / missing await
export async function batchUpdateBalances(userIds: string[], amount: number, updateFn: (id: string, a: number) => Promise<void>): Promise<void> {
  // Vulnerable: forEach does not await promises, causing unhandled background races
  userIds.forEach(async (id) => {
    await updateFn(id, amount);
  });
}
