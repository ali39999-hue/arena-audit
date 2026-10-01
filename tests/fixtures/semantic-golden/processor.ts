import { UserService, User } from './models.js';

export interface PaymentRequest {
  userId: string;
  amount: number;
}

export class PaymentProcessor {
  private userService: UserService;

  constructor(userService: UserService) {
    this.userService = userService;
  }

  public processPayment(req: PaymentRequest): boolean {
    const user = this.userService.getUser(req.userId);
    if (!user) {
      return false;
    }
    return this.executeTransaction(user, req.amount);
  }

  private executeTransaction(user: User, amount: number): boolean {
    console.log(`Processing ${amount} for ${user.name}`);
    return true;
  }
}

export function createProcessor(): PaymentProcessor {
  const svc = new UserService();
  return new PaymentProcessor(svc);
}
