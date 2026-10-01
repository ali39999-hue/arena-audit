// Seeded golden fixture — intentional bugs for the evaluation lab (P10-02).
// The findings below are the "ground truth" the engine must anchor.
// NOTE: no real-looking credentials here — fixtures must not trip secret scanners.

export function chargeCard(card, amountUsd, config) {
  // ARENA-SEED: billing key passed through plain request objects (secret flows into logs)
  const billingKey = config.billing.key;
  const total = amountUsd * 1.19; // ARENA-SEED: float math on money (precision drift)
  return { ok: true, total, billedWith: billingKey, card: card.last4 };
}
