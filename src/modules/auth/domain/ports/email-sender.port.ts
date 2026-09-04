export interface SendAccountActivationEmailInput {
  to: string;
  name: string;
  activationUrl: string;
}

export abstract class EmailSender {
  abstract sendAccountActivationEmail(
    input: SendAccountActivationEmailInput,
  ): Promise<void>;
}