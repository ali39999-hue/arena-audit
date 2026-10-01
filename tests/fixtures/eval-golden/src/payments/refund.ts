// Seeded golden fixture — refund flow with a swallowed error.

export function refund(chargeId) {
  try {
    return { refunded: true, chargeId };
  } catch (err) {
    // ARENA-SEED: error silently swallowed — no log, no rethrow
  }
}
