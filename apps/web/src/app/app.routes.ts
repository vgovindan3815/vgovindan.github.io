import { Routes } from '@angular/router';
import { HomeComponent } from './home.component';
import { BatchComponent } from './batch.component';
import { LandingComponent } from './landing.component';
import { DashboardComponent } from './dashboard.component';
import { AdminComponent } from './admin.component';
import { authGuard } from './auth.guard';
import { roleGuard } from './role.guard';

export const routes: Routes = [
  { path: '', component: LandingComponent },
  { path: 'login', component: LandingComponent },
  { path: 'home', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'manual', component: HomeComponent, canActivate: [authGuard] },
  { path: 'batch', component: BatchComponent, canActivate: [authGuard] },
  {
    path: 'admin',
    component: AdminComponent,
    canActivate: [authGuard, roleGuard],
    data: { roles: ['ADMIN'] },
  },
  { path: '**', redirectTo: 'login' },
];
