jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));

import { makeUser, mockOf } from '../../../../test-support/auth-fixtures';
import { UserStatus } from '../../../users/domain/entities/user-status.enum';
import { RecoveryTokenType } from '../../domain/ports/recovery-token-type.enum';
import { InvalidActivationTokenError } from '../../domain/errors/invalid-activation-token.error';
import { InvalidCredentialsError } from '../../domain/errors/invalid-credentials.error';
import { InvalidCurrentPasswordError } from '../../domain/errors/invalid-current-password.error';
import { InvalidPasswordResetTokenError } from '../../domain/errors/invalid-password-reset-token.error';
import { PasswordsDoNotMatchError } from '../../domain/errors/passwords-do-not-match.error';
import { ChangePasswordUseCase } from './change-password.use-case';
import { ForgotPasswordUseCase } from './forgot-password.use-case';
import { ReactivateAccountUseCase } from './reactivate-account.use-case';
import { RequestReactivationUseCase } from './request-reactivation.use-case';
import { ResendActivationUseCase } from './resend-activation.use-case';
import { ResetPasswordUseCase } from './reset-password.use-case';

const secure = () => ({ generate: jest.fn().mockReturnValue('raw token'), hash: jest.fn((v: string) => `hash(${v})`) });
const config = () => ({ getOrThrow: jest.fn().mockReturnValue('https://app.example.com') });

/**
 * The three "send me a link" flows share their shape: they answer the same
 * generic response for unknown or ineligible accounts and only email eligible ones.
 */
describe.each([
  {
    name: 'ForgotPasswordUseCase',
    Ctor: ForgotPasswordUseCase,
    eligible: UserStatus.ACTIVE,
    ineligible: [UserStatus.PENDING, UserStatus.DEACTIVATED],
    type: RecoveryTokenType.PASSWORD_RESET,
    mail: 'sendPasswordResetEmail',
    url: 'https://app.example.com/reset-password?token=raw%20token',
    urlKey: 'resetUrl',
  },
  {
    name: 'ResendActivationUseCase',
    Ctor: ResendActivationUseCase,
    eligible: UserStatus.PENDING,
    ineligible: [UserStatus.ACTIVE, UserStatus.DEACTIVATED],
    type: RecoveryTokenType.ACCOUNT_ACTIVATION,
    mail: 'sendAccountActivationEmail',
    url: 'https://app.example.com/activate-account?token=raw%20token',
    urlKey: 'activationUrl',
  },
  {
    name: 'RequestReactivationUseCase',
    Ctor: RequestReactivationUseCase,
    eligible: UserStatus.DEACTIVATED,
    ineligible: [UserStatus.ACTIVE, UserStatus.PENDING],
    type: RecoveryTokenType.ACCOUNT_REACTIVATION,
    mail: 'sendAccountReactivationEmail',
    url: 'https://app.example.com/reactivate-account?token=raw%20token',
    urlKey: 'reactivationUrl',
  },
])('$name', ({ Ctor, eligible, ineligible, type, mail, url, urlKey }) => {
  function setup(user: ReturnType<typeof makeUser> | null) {
    const users = mockOf('findByEmail');
    users.findByEmail.mockResolvedValue(user);
    const tokens = mockOf('invalidateUnusedByUserAndType', 'create');
    const email = mockOf('sendPasswordResetEmail', 'sendAccountActivationEmail', 'sendAccountReactivationEmail');
    const useCase = new Ctor(users as never, tokens as never, secure(), email as never, config() as never);
    return { useCase, users, tokens, email };
  }

  it('emails a single-use link to an eligible account', async () => {
    const status = eligible;
    const { useCase, users, tokens, email } = setup(
      makeUser({ status, deactivatedAt: status === UserStatus.DEACTIVATED ? new Date() : null }),
    );

    await expect(useCase.execute({ email: ' Ana@Example.com ' })).resolves.toEqual({ sent: true });

    expect(users.findByEmail).toHaveBeenCalledWith('ana@example.com');
    expect(tokens.invalidateUnusedByUserAndType).toHaveBeenCalledWith('u1', type);
    expect(tokens.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', tokenHash: 'hash(raw token)', type }),
    );
    expect(email[mail as keyof typeof email]).toHaveBeenCalledWith({ to: 'ana@example.com', name: 'Ana', [urlKey]: url });
  });

  it.each([null, ...ineligible])('answers generically without emailing for %p', async (status) => {
    const { useCase, email, tokens } = setup(
      status === null ? null : makeUser({ status, deactivatedAt: status === UserStatus.DEACTIVATED ? new Date() : null }),
    );
    await expect(useCase.execute({ email: 'x@example.com' })).resolves.toEqual({ sent: true });
    expect(tokens.create).not.toHaveBeenCalled();
    expect(Object.values(email).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });
});

describe('ResetPasswordUseCase', () => {
  function setup(token: unknown = { id: 'rt1', userId: 'u1' }) {
    const recovery = mockOf('findValidByHashAndType', 'markAsUsed');
    recovery.findValidByHashAndType.mockResolvedValue(token);
    const users = mockOf('updatePassword', 'incrementSessionVersion');
    const refresh = mockOf('revokeAllByUser');
    const hasher = { hash: jest.fn().mockResolvedValue('new-hash') };
    const useCase = new ResetPasswordUseCase(secure(), hasher as never, recovery as never, users as never, refresh as never);
    return { useCase, recovery, users, refresh };
  }
  const input = { token: 't', password: 'New#2026a', passwordConfirmation: 'New#2026a' };

  it('sets the new password, consumes the token and closes every session', async () => {
    const { useCase, recovery, users, refresh } = setup();
    await expect(useCase.execute(input)).resolves.toEqual({ reset: true });
    expect(recovery.findValidByHashAndType).toHaveBeenCalledWith('hash(t)', RecoveryTokenType.PASSWORD_RESET);
    expect(users.updatePassword).toHaveBeenCalledWith('u1', 'new-hash');
    expect(recovery.markAsUsed).toHaveBeenCalledWith('rt1');
    expect(users.incrementSessionVersion).toHaveBeenCalledWith('u1');
    expect(refresh.revokeAllByUser).toHaveBeenCalledWith('u1');
  });

  it('rejects mismatched passwords and invalid tokens', async () => {
    await expect(setup().useCase.execute({ ...input, passwordConfirmation: 'x' })).rejects.toBeInstanceOf(
      PasswordsDoNotMatchError,
    );
    await expect(setup(null).useCase.execute(input)).rejects.toBeInstanceOf(InvalidPasswordResetTokenError);
  });
});

describe('ChangePasswordUseCase', () => {
  function setup(user: unknown = makeUser(), currentOk = true) {
    const users = mockOf('findById', 'updatePassword', 'incrementSessionVersion');
    users.findById.mockResolvedValue(user);
    const hasher = { verify: jest.fn().mockResolvedValue(currentOk), hash: jest.fn().mockResolvedValue('new-hash') };
    const refresh = mockOf('revokeAllByUser');
    return { useCase: new ChangePasswordUseCase(users as never, hasher, refresh as never), users, refresh };
  }
  const input = { userId: 'u1', currentPassword: 'old', newPassword: 'New#2026a', newPasswordConfirmation: 'New#2026a' };

  it('changes the password and revokes existing sessions', async () => {
    const { useCase, users, refresh } = setup();
    await expect(useCase.execute(input)).resolves.toEqual({ changed: true });
    expect(users.updatePassword).toHaveBeenCalledWith('u1', 'new-hash');
    expect(users.incrementSessionVersion).toHaveBeenCalledWith('u1');
    expect(refresh.revokeAllByUser).toHaveBeenCalledWith('u1');
  });

  it('rejects mismatched confirmation, unknown users and a wrong current password', async () => {
    await expect(setup().useCase.execute({ ...input, newPasswordConfirmation: 'x' })).rejects.toBeInstanceOf(
      PasswordsDoNotMatchError,
    );
    await expect(setup(null).useCase.execute(input)).rejects.toBeInstanceOf(InvalidCredentialsError);
    const wrong = setup(makeUser(), false);
    await expect(wrong.useCase.execute(input)).rejects.toBeInstanceOf(InvalidCurrentPasswordError);
    expect(wrong.users.updatePassword).not.toHaveBeenCalled();
  });
});

describe('ReactivateAccountUseCase', () => {
  function setup(token: unknown, user: unknown) {
    const recovery = mockOf('findValidByHashAndType', 'markAsUsed');
    recovery.findValidByHashAndType.mockResolvedValue(token);
    const users = mockOf('findById', 'reactivate');
    users.findById.mockResolvedValue(user);
    return { useCase: new ReactivateAccountUseCase(secure(), recovery as never, users as never), users, recovery };
  }
  const deactivated = makeUser({ status: UserStatus.DEACTIVATED, deactivatedAt: new Date() });

  it('reactivates a deactivated account and consumes the token', async () => {
    const { useCase, users, recovery } = setup({ id: 'rt', userId: 'u1' }, deactivated);
    await expect(useCase.execute({ token: 't' })).resolves.toEqual({ reactivated: true });
    expect(users.reactivate).toHaveBeenCalledWith('u1');
    expect(recovery.markAsUsed).toHaveBeenCalledWith('rt');
  });

  it.each([
    ['no token', null, deactivated],
    ['no user', { id: 'rt', userId: 'u1' }, null],
    ['an active user', { id: 'rt', userId: 'u1' }, makeUser()],
  ])('rejects %s', async (_label, token, user) => {
    const { useCase, users } = setup(token, user);
    await expect(useCase.execute({ token: 't' })).rejects.toBeInstanceOf(InvalidActivationTokenError);
    expect(users.reactivate).not.toHaveBeenCalled();
  });
});
