import { Injectable, Module } from '@nestjs/common';

type RevocationListener = (userId: string, sessionVersion: number) => void;

@Injectable()
export class SessionRevocationService {
  private readonly listeners = new Set<RevocationListener>();

  subscribe(listener: RevocationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  revokeOlderSessions(userId: string, sessionVersion: number): void {
    for (const listener of this.listeners) listener(userId, sessionVersion);
  }
}

@Module({
  providers: [SessionRevocationService],
  exports: [SessionRevocationService],
})
export class SessionRevocationModule {}
