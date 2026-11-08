jest.mock('../../../auth/presentation/http/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class JwtAuthGuard {} }));
jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));
jest.mock('../../../../infrastructure/database/prisma/prisma-rls.service', () => ({ PrismaRlsService: class PrismaRlsService {} }));
jest.mock('../../../realtime/realtime-events.service', () => ({ RealtimeEventsService: class RealtimeEventsService {} }));

import { NotificationsController } from './notifications.controller';

describe('NotificationsController', () => {
  const user = { userId: 'u1', role: 'USER' };
  const id = 'e0000000-0000-4000-8000-000000000001';

  it('scopes every notification operation to the caller', async () => {
    const make = (value: unknown) => ({ execute: jest.fn().mockResolvedValue(value) });
    const list = make([]);
    const status = make({ updated: true });
    const unread = make({ unreadCount: 2 });
    const markAll = make({ updated: 2 });
    const controller = new NotificationsController(list as never, status as never, unread as never, markAll as never);

    await expect(controller.unreadCount(user)).resolves.toEqual({ unreadCount: 2 });
    await expect(controller.list(user, { status: 'UNREAD', limit: 5 } as never)).resolves.toEqual([]);
    await expect(controller.markAllAsRead(user)).resolves.toEqual({ updated: 2 });
    await controller.markAsRead(user, id);
    await controller.dismiss(user, id);

    expect(unread.execute).toHaveBeenCalledWith({ userId: 'u1' });
    expect(list.execute).toHaveBeenCalledWith({ userId: 'u1', status: 'UNREAD', limit: 5 });
    expect(markAll.execute).toHaveBeenCalledWith({ userId: 'u1' });
    expect(status.execute).toHaveBeenNthCalledWith(1, { userId: 'u1', notificationId: id, status: 'READ' });
    expect(status.execute).toHaveBeenNthCalledWith(2, { userId: 'u1', notificationId: id, status: 'DISMISSED' });
  });
});
