/** Keep late menu work from replacing a newer selection or confirmation. */
export class MenuRequestScope {
  private generation = 0;
  private disposed = false;
  private readonly isSessionCurrent: () => boolean;

  constructor(isSessionCurrent: () => boolean = () => true) {
    this.isSessionCurrent = isSessionCurrent;
  }

  isActive(): boolean {
    return !this.disposed && this.isSessionCurrent();
  }

  /** Starting another action supersedes the previous action in this menu. */
  begin(): number {
    return ++this.generation;
  }

  owns(ticket: number): boolean {
    return this.isActive() && ticket === this.generation;
  }

  invalidate(): void {
    this.generation++;
  }

  dispose(): void {
    this.disposed = true;
    this.invalidate();
  }
}
