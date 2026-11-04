import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

import {
  EmailSender,
  SendAccountActivationEmailInput,
  SendPasswordResetEmailInput,
  SendAccountReactivationEmailInput,
} from '../../domain/ports/email-sender.port';
@Injectable()
export class GmailEmailSender implements EmailSender {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(private readonly configService: ConfigService) {
    const user =
      this.configService.getOrThrow<string>('SMTP_USER');

    const password =
      this.configService.getOrThrow<string>('SMTP_APP_PASSWORD');

    this.from =
      this.configService.get<string>('SMTP_FROM') ?? user;

    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user,
        pass: password,
      },
    });
  }

  async sendAccountActivationEmail(
    input: SendAccountActivationEmailInput,
  ): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: input.to,
      subject: 'Activa tu cuenta de Smart Home',
      text: [
        `Hola ${input.name},`,
        '',
        'Tu cuenta de Smart Home fue registrada correctamente.',
        'Para activarla, utiliza el siguiente enlace:',
        '',
        input.activationUrl,
        '',
        'Este enlace tiene una vigencia limitada.',
        '',
        'Si no realizaste este registro, ignora este mensaje.',
      ].join('\n'),
      html: `
        <h2>Activa tu cuenta de Smart Home</h2>

        <p>Hola ${input.name},</p>

        <p>
          Tu cuenta fue registrada correctamente.
          Para activarla, utiliza el siguiente enlace:
        </p>

        <p>
          <a href="${input.activationUrl}">
            Activar cuenta
          </a>
        </p>

        <p>
          Este enlace tiene una vigencia limitada.
        </p>

        <p>
          Si no realizaste este registro, ignora este mensaje.
        </p>
      `,
    });
  }

  async sendAccountReactivationEmail(
  input: SendAccountReactivationEmailInput,
): Promise<void> {
  await this.transporter.sendMail({
    from: this.from,
    to: input.to,
    subject: 'Reactiva tu cuenta de Smart Home',

    text: [
      `Hola ${input.name},`,
      '',
      'Recibimos una solicitud para reactivar tu cuenta de Smart Home.',
      'Utiliza el siguiente enlace:',
      '',
      input.reactivationUrl,
      '',
      'Este enlace tiene una vigencia limitada.',
      '',
      'Si no solicitaste esta reactivación, ignora este mensaje.',
    ].join('\n'),

    html: `
      <h2>Reactiva tu cuenta de Smart Home</h2>

      <p>Hola ${input.name},</p>

      <p>
        Recibimos una solicitud para reactivar tu cuenta.
      </p>

      <p>
        <a href="${input.reactivationUrl}">
          Reactivar cuenta
        </a>
      </p>

      <p>
        Este enlace tiene una vigencia limitada.
      </p>

      <p>
        Si no solicitaste esta reactivación,
        ignora este mensaje.
      </p>
    `,
  });
}
  async sendPasswordResetEmail(
  input: SendPasswordResetEmailInput,
): Promise<void> {
  await this.transporter.sendMail({
    from: this.from,
    to: input.to,
    subject: 'Restablece tu contraseña de Smart Home',
    text: [
      `Hola ${input.name},`,
      '',
      'Recibimos una solicitud para restablecer tu contraseña.',
      'Utiliza el siguiente enlace:',
      '',
      input.resetUrl,
      '',
      'Este enlace tiene una vigencia limitada.',
      '',
      'Si no solicitaste este cambio, ignora este mensaje.',
    ].join('\n'),
    html: `
      <h2>Restablece tu contraseña de Smart Home</h2>

      <p>Hola ${input.name},</p>

      <p>
        Recibimos una solicitud para restablecer tu contraseña.
        Utiliza el siguiente enlace:
      </p>

      <p>
        <a href="${input.resetUrl}">
          Restablecer contraseña
        </a>
      </p>

      <p>
        Este enlace tiene una vigencia limitada.
      </p>

      <p>
        Si no solicitaste este cambio, ignora este mensaje.
      </p>
    `,
  });

  
}
}