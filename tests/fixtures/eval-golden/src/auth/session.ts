// Seeded golden fixture — session handling.

export function createSession(user) {
  const token = btoa(user.id + ':' + Date.now());
  // ARENA-SEED: token persisted in localStorage (XSS-stealable)
  return { token, store: 'localStorage' };
}

export function isSessionValid(session) {
  // ARENA-SEED: no expiry check — sessions never expire
  return Boolean(session && session.token);
}
