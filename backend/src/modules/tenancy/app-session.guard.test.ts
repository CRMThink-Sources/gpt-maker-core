import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../shared/http/api-exception.filter';
import type { SessionClaims } from '../../shared/platform/session-verifier';
import { type AppAccess, type AppSession, AppSessionGuard } from './app-session.guard';
import type { PermissionService } from './permission.service';
import type { Tenant, TenantService } from './tenant.service';

const claims = (overrides: Partial<SessionClaims> = {}) =>
  ({
    sub: '7',
    aud: 'crmthink.gptmaker',
    installationId: 1001,
    memberId: 'm-1',
    domain: 'acme.bitrix24.com.br',
    isAdmin: false,
    name: 'Ana',
    departmentIds: [],
    ...overrides,
  }) as SessionClaims;

const tenant = { id: 't-1', tenantCode: 'abc123', status: 'ACTIVE' } as Tenant;

function setup(options: {
  verify?: () => Promise<SessionClaims>;
  tenant?: Tenant | undefined;
  granted?: boolean;
  access?: AppAccess;
}) {
  const verify = vi.fn(options.verify ?? (async () => claims()));
  const guard = new AppSessionGuard(
    verify,
    {
      findByInstallationId: vi.fn(async () => ('tenant' in options ? options.tenant : tenant)),
    } as unknown as TenantService,
    {
      isGranted: vi.fn(async () => options.granted ?? false),
      rememberAdmin: vi.fn(async () => undefined),
    } as unknown as PermissionService,
    { getAllAndOverride: () => options.access } as unknown as Reflector,
  );
  const run = async (authorization?: string) => {
    const req: { header: (name: string) => string | undefined; appSession?: AppSession } = {
      header: (name) => (name === 'authorization' ? authorization : undefined),
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => undefined,
      getClass: () => undefined,
    } as unknown as ExecutionContext;
    await guard.canActivate(context);
    return req.appSession!;
  };
  return { run, verify };
}

describe('AppSessionGuard', () => {
  it('sem Bearer ou com JWT recusado ⇒ 401', async () => {
    await expect(setup({}).run()).rejects.toBeInstanceOf(UnauthorizedException);
    const rejected = setup({
      verify: async () => Promise.reject(new Error('"aud" claim check failed')),
    });
    await expect(rejected.run('Bearer x')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('identifica tenant, usuário e admin pelas claims', async () => {
    const { run, verify } = setup({ verify: async () => claims({ isAdmin: true }) });
    await expect(run('Bearer jwt-1')).resolves.toEqual({
      tenantId: 't-1',
      tenantCode: 'abc123',
      tenantStatus: 'ACTIVE',
      installationId: 1001,
      userId: '7',
      userName: 'Ana',
      isAdmin: true,
      canManage: true,
    });
    expect(verify).toHaveBeenCalledWith('jwt-1');
  });

  it('tenant ausente ou desinstalado ⇒ TENANT_NOT_INSTALLED', async () => {
    await expect(setup({ tenant: undefined }).run('Bearer x')).rejects.toMatchObject({
      code: 'TENANT_NOT_INSTALLED',
    });
    await expect(
      setup({ tenant: { ...tenant, status: 'UNINSTALLED' } }).run('Bearer x'),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('manage: admin ou usuário autorizado; admin: só admin do portal', async () => {
    await expect(setup({ access: 'manage' }).run('Bearer x')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(setup({ access: 'manage', granted: true }).run('Bearer x')).resolves.toMatchObject(
      {
        canManage: true,
        isAdmin: false,
      },
    );
    await expect(setup({ access: 'admin', granted: true }).run('Bearer x')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(setup({ access: 'read' }).run('Bearer x')).resolves.toMatchObject({
      canManage: false,
    });
  });
});
