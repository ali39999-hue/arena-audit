export interface User {
  id: string;
  name: string;
}

export class UserService {
  private users: User[] = [];

  public getUser(id: string): User | null {
    return this.users.find(u => u.id === id) || null;
  }
}
