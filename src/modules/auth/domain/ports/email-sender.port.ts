export interface SendAccountActivationEmailInput {
  to: string;
  name: string;
  activationUrl: string;
}

export interface SendAccountReactivationEmailInput {
  to: string;
  name: string;
  reactivationUrl: string;
}

export interface SendPasswordResetEmailInput {
  to: string;
  name: string;
  resetUrl: string;
}

export abstract class EmailSender {
  abstract sendAccountActivationEmail(
    input: SendAccountActivationEmailInput,
  ): Promise<void>;

  abstract sendAccountReactivationEmail(
  input: SendAccountReactivationEmailInput,
): Promise<void>;

  abstract sendPasswordResetEmail(
    input: SendPasswordResetEmailInput,
  ): Promise<void>;
}