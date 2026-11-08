jest.mock('../../../auth/presentation/http/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class JwtAuthGuard {} }));
jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));

import { UsersController } from './users.controller';

describe('UsersController', () => {
  const user = { userId: 'u1', role: 'USER' };
  const make = (value: unknown) => ({ execute: jest.fn().mockResolvedValue(value) });

  it('reads and updates only the caller profile and preferences', async () => {
    const cases = [make({ name: 'Ana' }), make({ name: 'Ana B' }), make({ theme: 'dark' }), make({ theme: 'light' }), make({ deactivated: true })];
    const controller = new UsersController(...(cases as unknown as ConstructorParameters<typeof UsersController>));

    await expect(controller.getMyProfile(user)).resolves.toEqual({ name: 'Ana' });
    await expect(controller.updateMyProfile(user, { name: 'Ana B' })).resolves.toEqual({ name: 'Ana B' });
    await expect(controller.getMyPreferences(user)).resolves.toEqual({ theme: 'dark' });
    await expect(controller.updateMyPreferences(user, { theme: 'light' })).resolves.toEqual({ theme: 'light' });
    await expect(controller.deactivateMyAccount(user, { confirm: true })).resolves.toEqual({ deactivated: true });

    expect(cases[0].execute).toHaveBeenCalledWith('u1');
    expect(cases[1].execute).toHaveBeenCalledWith('u1', { name: 'Ana B' });
    expect(cases[2].execute).toHaveBeenCalledWith('u1');
    expect(cases[3].execute).toHaveBeenCalledWith('u1', { theme: 'light' });
    expect(cases[4].execute).toHaveBeenCalledWith('u1');
  });
});
