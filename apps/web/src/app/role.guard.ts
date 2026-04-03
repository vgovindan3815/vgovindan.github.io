import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './services/auth.service';

export const roleGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const roles = (route.data?.['roles'] as string[] | undefined) ?? [];

  if (auth.isAuthenticated() && auth.hasAnyRole(roles)) {
    return true;
  }

  return router.parseUrl('/home');
};
