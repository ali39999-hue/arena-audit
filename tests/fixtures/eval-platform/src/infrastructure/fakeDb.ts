export class DatabaseConnectionPool {
  public rawExecute(sql: string): void {
    console.log('Executing:', sql);
  }
}
