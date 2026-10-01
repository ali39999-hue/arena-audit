// SEED: Layering violation - pure domain entity imports low-level database driver
// In Clean/Hexagonal Architecture, domains must never import infrastructure drivers
import { DatabaseConnectionPool } from '../infrastructure/fakeDb.js';

export interface BookingEntity {
  id: string;
  totalAmount: number;
}

export class BookingDomainModel {
  // Violation: Domain class couples directly to database connection pool
  private db: DatabaseConnectionPool = new DatabaseConnectionPool();

  public confirmBooking(booking: BookingEntity): void {
    this.db.rawExecute(`UPDATE bookings SET status = 'CONFIRMED' WHERE id = '${booking.id}'`);
  }
}
