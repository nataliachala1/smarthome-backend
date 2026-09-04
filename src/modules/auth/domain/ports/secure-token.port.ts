export abstract class SecureToken {
  abstract generate(): string;
  abstract hash(token: string): string;
}