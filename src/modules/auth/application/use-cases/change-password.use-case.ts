import { Injectable } from '@nestjs/common';

import { PasswordHasher } from '../../domain/ports/password-hasher.port';
import { UserRepository } from '../../../users/domain/repositories/user.repository';

import { PasswordsDoNotMatchError } from '../../domain/errors/passwords-do-not-match.error';
import { InvalidCurrentPasswordError } from '../../domain/errors/invalid-current-password.error';
import { InvalidCredentialsError } from '../../domain/errors/invalid-credentials.error';

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
  newPasswordConfirmation: string;
}

export interface ChangePasswordOutput {
  changed: boolean;
}

@Injectable()
export class ChangePasswordUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async execute(
    input: ChangePasswordInput,
  ): Promise<ChangePasswordOutput> {
    if (input.newPassword !== input.newPasswordConfirmation) {
      throw new PasswordsDoNotMatchError();
    }

    const user = await this.userRepository.findById(input.userId);

    if (!user) {
      throw new InvalidCredentialsError();
    }

    const currentPasswordIsValid =
      await this.passwordHasher.verify(
        user.passwordHash,
        input.currentPassword,
      );

    if (!currentPasswordIsValid) {
      throw new InvalidCurrentPasswordError();
    }

    const newPasswordHash =
      await this.passwordHasher.hash(input.newPassword);

    await this.userRepository.updatePassword(
      user.id,
      newPasswordHash,
    );

    return {
      changed: true,
    };
  }
}