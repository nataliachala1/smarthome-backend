import { Injectable, Module } from '@nestjs/common';

type RevocationListener = (userId: string, sessionVersion: number) => void;
type FamilyListener = (userId: string, familyId: string) => void;

@Injectable()
export class SessionRevocationService {
  private readonly listeners = new Set<RevocationListener>();
  private readonly familyListeners = new Set<FamilyListener>();

  subscribeFamily(listener: FamilyListener): () => void {
    this.familyListeners.add(listener);
    return () => this.familyListeners.delete(listener);
  }

  revokeFamily(userId: string, familyId: string): void {
    for (const listener of this.familyListeners) listener(userId, familyId);
  }

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
