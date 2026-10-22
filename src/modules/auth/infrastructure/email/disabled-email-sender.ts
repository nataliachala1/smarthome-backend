import { ServiceUnavailableException } from '@nestjs/common';
import { EmailSender } from '../../domain/ports/email-sender.port';

export class DisabledEmailSender implements EmailSender {
  private unavailable(): Promise<void> {
    return Promise.reject(new ServiceUnavailableException(
      'El envío de correo no está configurado. Contacta al administrador.',
    ));
  }

  sendAccountActivationEmail(): Promise<void> {
    return this.unavailable();
  }

  sendAccountReactivationEmail(): Promise<void> {
    return this.unavailable();
  }

  sendPasswordResetEmail(): Promise<void> {
    return this.unavailable();
  }
}
