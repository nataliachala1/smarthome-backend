import { ServiceUnavailableException } from '@nestjs/common';
import {
  EmailSender,
  SendAccountActivationEmailInput,
  SendAccountReactivationEmailInput,
  SendPasswordResetEmailInput,
} from '../../domain/ports/email-sender.port';

export class DisabledEmailSender implements EmailSender {
  private unavailable(): never {
    throw new ServiceUnavailableException(
      'El envío de correo no está configurado. Contacta al administrador.',
    );
  }

  async sendAccountActivationEmail(
    _input: SendAccountActivationEmailInput,
  ): Promise<void> {
    this.unavailable();
  }

  async sendAccountReactivationEmail(
    _input: SendAccountReactivationEmailInput,
  ): Promise<void> {
    this.unavailable();
  }

  async sendPasswordResetEmail(
    _input: SendPasswordResetEmailInput,
  ): Promise<void> {
    this.unavailable();
  }
}
