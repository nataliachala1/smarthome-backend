export abstract class PasswordHasher {
  abstract hash(password: string): Promise<string>;

  abstract verify(
    hash: string,
    plainPassword: string,
  ): Promise<boolean>;
}