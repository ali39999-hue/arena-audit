// FALSE POSITIVE TRAP: Looks like string concatenation but is actually
// a safe tagged template function with parameterized escaping.
function sql(strings: TemplateStringsArray, ...values: any[]): { query: string; params: any[] } {
  const query = strings.join('?');
  return { query, params: values };
}

export function findUserById(userId: string) {
  // Safe: uses tagged template with parameterization, not raw concatenation
  return sql`SELECT id, name FROM users WHERE id = ${userId}`;
}
