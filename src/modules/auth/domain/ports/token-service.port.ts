export interface AccessTokenPayload {
  userId: string;
  globalRole: string;
  sessionVersion: number;
}

export abstract class TokenService {
  abstract generateAccessToken(
    payload: AccessTokenPayload,
  ): Promise<string>;
}