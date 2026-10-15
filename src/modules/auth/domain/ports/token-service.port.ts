export interface AccessTokenPayload {
  userId: string;
  globalRole: string;
  sessionVersion: number;
  sessionId: string;
}

export abstract class TokenService {
  abstract generateAccessToken(payload: AccessTokenPayload): Promise<string>;
}
