jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));

import { ServiceUnavailableException } from '@nestjs/common';

import { EmailAlreadyExistsError } from '../../domain/errors/email-already-exists.error';
import { PasswordsDoNotMatchError } from '../../domain/errors/passwords-do-not-match.error';
import { UserStatus } from '../../../users/domain/entities/user-status.enum';
import {
  PendingRegistrationData,
  RegisteredUser,
} from '../../domain/repositories/account-registration.repository';
import { RegisterUserUseCase } from './register-user.use-case';

describe('RegisterUserUseCase', () => {
  const registered = {
    id: 'u1',
    name: 'Ana',
    email: 'ana@example.com',
    status: UserStatus.PENDING,
    emailVerified: false,
  };

  function setup(options: { existing?: boolean; emailFails?: boolean } = {}) {
    const userRepository = {
      findByEmail: jest.fn().mockResolvedValue(options.existing ? { id: 'x' } : null),
    };
    const passwordHasher = { hash: jest.fn().mockResolvedValue('hash'), verify: jest.fn() };
    const secureToken = { generate: jest.fn().mockReturnValue('raw token'), hash: jest.fn().mockReturnValue('token-hash') };
    const emailSender = {
      sendAccountActivationEmail: options.emailFails
        ? jest.fn().mockRejectedValue(new ServiceUnavailableException('smtp down'))
        : jest.fn().mockResolvedValue(undefined),
      sendAccountReactivationEmail: jest.fn(),
      sendPasswordResetEmail: jest.fn(),
    };
    // Simulates the database transaction: the callback runs before commit and
    // any error it throws aborts the whole registration.
    const committed: PendingRegistrationData[] = [];
    const registrationRepository = {
      registerPendingUser: jest.fn(
        async (
          data: PendingRegistrationData,
          beforeCommit: (user: RegisteredUser) => Promise<void>,
        ) => {
        await beforeCommit(registered);
        committed.push(data);
        return registered;
        },
      ),
    };
    const config = { getOrThrow: jest.fn().mockReturnValue('https://app.example.com') };
    const useCase = new RegisterUserUseCase(
      userRepository as never,
      passwordHasher,
      secureToken,
      registrationRepository,
      emailSender,
      config as never,
    );
    return { useCase, emailSender, registrationRepository, committed, userRepository };
  }

  const input = {
    name: '  Ana  ',
    email: ' Ana@Example.com ',
    password: 'SmartHome#2026',
    passwordConfirmation: 'SmartHome#2026',
  };

  it('registers a pending user and sends the activation link before commit', async () => {
    const { useCase, emailSender, registrationRepository, committed, userRepository } = setup();

    await expect(useCase.execute(input)).resolves.toEqual(registered);

    expect(userRepository.findByEmail).toHaveBeenCalledWith('ana@example.com');
    expect(registrationRepository.registerPendingUser).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Ana',
        email: 'ana@example.com',
        passwordHash: 'hash',
        activationTokenHash: 'token-hash',
      }),
      expect.any(Function),
    );
    expect(committed[0].activationTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(emailSender.sendAccountActivationEmail).toHaveBeenCalledWith({
      to: 'ana@example.com',
      name: 'Ana',
      activationUrl: 'https://app.example.com/activate-account?token=raw%20token',
    });
    expect(committed).toHaveLength(1);
  });

  it('persists nothing when the activation email cannot be sent', async () => {
    const { useCase, committed } = setup({ emailFails: true });

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(committed).toHaveLength(0);
  });

  it('rejects different password confirmation', async () => {
    const { useCase, registrationRepository } = setup();
    await expect(
      useCase.execute({ ...input, passwordConfirmation: 'Other#2026' }),
    ).rejects.toBeInstanceOf(PasswordsDoNotMatchError);
    expect(registrationRepository.registerPendingUser).not.toHaveBeenCalled();
  });

  it('rejects an email that already exists', async () => {
    const { useCase, registrationRepository } = setup({ existing: true });
    await expect(useCase.execute(input)).rejects.toBeInstanceOf(EmailAlreadyExistsError);
    expect(registrationRepository.registerPendingUser).not.toHaveBeenCalled();
  });
});
