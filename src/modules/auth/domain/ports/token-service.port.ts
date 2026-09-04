export interface AccessTokenPayload {
  userId: string;
  globalRole: string;
}

export abstract class TokenService {
  abstract generateAccessToken(
    payload: AccessTokenPayload,
  ): Promise<string>;
}