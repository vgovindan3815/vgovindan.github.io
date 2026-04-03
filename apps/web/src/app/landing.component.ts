import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.scss',
})
export class LandingComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  username = 'Admin';
  password = 'Admin@123';
  errorMessage = '';

  constructor() {
    if (this.auth.isAuthenticated()) {
      void this.router.navigateByUrl('/home');
    }
  }

  async login(): Promise<void> {
    this.errorMessage = '';
    const result = await this.auth.login(this.username, this.password);
    if (!result.success) {
      this.errorMessage = result.error ?? 'Login failed.';
      return;
    }

    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/home';
    void this.router.navigateByUrl(returnUrl);
  }

  useDemoAccount(username: string, password: string): void {
    this.username = username;
    this.password = password;
    this.errorMessage = '';
  }
}