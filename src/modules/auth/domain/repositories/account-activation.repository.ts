export abstract class AccountActivationRepository {
  abstract activateAccount(
    userId: string,
    recoveryTokenId: string,
  ): Promise<void>;
}