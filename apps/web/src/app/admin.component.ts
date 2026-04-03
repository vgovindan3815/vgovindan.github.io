import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { AuthService, AuthRole, AuthUser, CreateUserInput, UserStatus } from './services/auth.service';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="admin-shell">
      <section class="admin-hero">
        <div>
          <div class="admin-kicker">Administration</div>
          <h1>Local user access and role control.</h1>
          <p>Manage the seeded Admin and freight_user accounts for this freight workspace.</p>
        </div>
      </section>

      <section class="admin-grid">
        <article class="admin-card admin-card--summary">
          <h2>User Summary</h2>
          <div class="summary-grid">
            <div class="summary-item">
              <span>Total Users</span>
              <strong>{{ users.length }}</strong>
            </div>
            <div class="summary-item">
              <span>Active Users</span>
              <strong>{{ activeCount }}</strong>
            </div>
            <div class="summary-item">
              <span>Admin Users</span>
              <strong>{{ adminCount }}</strong>
            </div>
          </div>
        </article>

        <article class="admin-card">
          <h2>Create User</h2>

          <div class="form-grid">
            <label>
              <span>Username</span>
              <input [(ngModel)]="newUsername" name="newUsername" placeholder="jdoe" autocomplete="off">
            </label>
            <label>
              <span>Display Name</span>
              <input [(ngModel)]="newDisplayName" name="newDisplayName" placeholder="John Doe" autocomplete="off">
            </label>
            <label>
              <span>Role</span>
              <select [(ngModel)]="newRole" name="newRole">
                <option value="FREIGHT_USER">FREIGHT_USER</option>
                <option value="ADMIN">ADMIN</option>
              </select>
            </label>
            <label>
              <span>Status</span>
              <select [(ngModel)]="newStatus" name="newStatus">
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </label>
            <label class="form-grid__full">
              <span>Temporary Password</span>
              <input [(ngModel)]="newPassword" name="newPassword" placeholder="Set initial password">
            </label>
          </div>

          <div class="button-row">
            <button type="button" class="btn btn-primary" (click)="createUser()">Create User</button>
          </div>
        </article>

        <article class="admin-card admin-card--table">
          <h2>Users</h2>
          <table class="users-table">
            <thead>
              <tr>
                <th>Username</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Login</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let user of users" [class.is-selected]="selectedUser?.id === user.id">
                <td>{{ user.username }}</td>
                <td>{{ user.roles.join(', ') }}</td>
                <td>
                  <span class="status-badge" [class.status-badge--inactive]="user.status === 'INACTIVE'">
                    {{ user.status }}
                  </span>
                </td>
                <td>{{ user.lastLoginAt ? (user.lastLoginAt | date: 'yyyy-MM-dd HH:mm') : '-' }}</td>
                <td>
                  <button type="button" class="btn" (click)="selectUser(user)">Edit</button>
                  <span class="self-tag" *ngIf="currentUserId === user.id">Current User</span>
                </td>
              </tr>
            </tbody>
          </table>
        </article>

        <article class="admin-card" *ngIf="selectedUser">
          <h2>Edit User</h2>

          <div class="form-grid">
            <label>
              <span>Username</span>
              <input [value]="selectedUser.username" readonly>
            </label>
            <label>
              <span>Display Name</span>
              <input [value]="selectedUser.displayName" readonly>
            </label>
            <label>
              <span>Status</span>
              <select [(ngModel)]="selectedStatus" name="selectedStatus">
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </label>
            <label>
              <span>Reset Password</span>
              <input [(ngModel)]="selectedPassword" name="selectedPassword" placeholder="Leave blank to keep current password">
            </label>
          </div>

          <div class="message error" *ngIf="errorMessage">{{ errorMessage }}</div>
          <div class="message success" *ngIf="successMessage">{{ successMessage }}</div>

          <div class="button-row">
            <button type="button" class="btn btn-primary" (click)="saveUser()">Save Changes</button>
            <button type="button" class="btn" (click)="clearSelection()">Cancel</button>
          </div>
        </article>
      </section>
    </div>
  `,
  styles: [`
    .admin-shell {
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 20px 56px;
      display: grid;
      gap: 18px;
    }
    .admin-hero {
      padding: 28px;
      border-radius: 24px;
      color: #fff;
      background: linear-gradient(135deg, rgba(77, 20, 140, 0.96), rgba(57, 20, 99, 0.96) 54%, rgba(36, 16, 63, 0.98));
      box-shadow: 0 24px 52px rgba(56, 20, 94, 0.26);
    }
    .admin-kicker {
      margin-bottom: 10px;
      font-size: 0.8rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #ffc8ab;
    }
    .admin-hero h1 {
      margin: 0 0 10px;
      font-size: clamp(1.9rem, 2.5vw, 2.9rem);
      line-height: 1.08;
    }
    .admin-hero p {
      margin: 0;
      color: rgba(255, 255, 255, 0.82);
      line-height: 1.6;
    }
    .admin-grid {
      display: grid;
      gap: 18px;
    }
    .admin-card {
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(250, 246, 255, 0.96));
      border: 1px solid rgba(77, 20, 140, 0.1);
      border-radius: 20px;
      padding: 22px;
      box-shadow: 0 16px 36px rgba(32, 23, 52, 0.08);
    }
    .admin-card h2 {
      margin: 0 0 16px;
      color: #4d148c;
      font-size: 1.2rem;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .summary-item {
      padding: 16px;
      border-radius: 16px;
      background: rgba(77, 20, 140, 0.05);
      display: grid;
      gap: 6px;
    }
    .summary-item span {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #64748b;
    }
    .summary-item strong {
      font-size: 1.7rem;
      color: #0f172a;
    }
    .users-table {
      width: 100%;
      border-collapse: collapse;
    }
    .users-table thead {
      background: rgba(77, 20, 140, 0.06);
    }
    .users-table th,
    .users-table td {
      padding: 12px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.22);
      text-align: left;
    }
    .users-table tbody tr.is-selected {
      background: rgba(255, 98, 0, 0.08);
    }
    .self-tag {
      margin-left: 8px;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 0.72rem;
      background: rgba(59, 130, 246, 0.14);
      color: #1d4ed8;
      font-weight: 700;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(22, 163, 74, 0.12);
      color: #166534;
      font-size: 0.8rem;
      font-weight: 700;
    }
    .status-badge--inactive {
      background: rgba(220, 38, 38, 0.12);
      color: #991b1b;
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    .form-grid__full {
      grid-column: 1 / -1;
    }
    label {
      display: grid;
      gap: 8px;
      color: #334155;
      font-weight: 600;
    }
    input,
    select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid rgba(148, 163, 184, 0.4);
      border-radius: 12px;
      font: inherit;
      background: #fff;
      color: #0f172a;
    }
    .button-row {
      display: flex;
      gap: 10px;
      margin-top: 16px;
      flex-wrap: wrap;
    }
    .btn {
      padding: 10px 16px;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      background: #e2e8f0;
      color: #0f172a;
      font-weight: 600;
    }
    .btn-primary {
      background: #4d148c;
      color: #fff;
    }
    .message {
      margin-top: 14px;
      padding: 12px 14px;
      border-radius: 12px;
    }
    .error {
      background: rgba(220, 38, 38, 0.12);
      color: #991b1b;
    }
    .success {
      background: rgba(22, 163, 74, 0.12);
      color: #166534;
    }
    @media (max-width: 900px) {
      .summary-grid,
      .form-grid {
        grid-template-columns: 1fr;
      }
      .users-table {
        display: block;
        overflow-x: auto;
      }
    }
  `],
})
export class AdminComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  users: AuthUser[] = [];
  selectedUser: AuthUser | null = null;
  selectedStatus: UserStatus = 'ACTIVE';
  selectedPassword = '';
  errorMessage = '';
  successMessage = '';

  newUsername = '';
  newDisplayName = '';
  newPassword = '';
  newRole: AuthRole = 'FREIGHT_USER';
  newStatus: UserStatus = 'ACTIVE';

  get activeCount(): number {
    return this.users.filter((user) => user.status === 'ACTIVE').length;
  }

  get adminCount(): number {
    return this.users.filter((user) => user.roles.includes('ADMIN')).length;
  }

  get currentUserId(): string | null {
    return this.auth.user?.id ?? null;
  }

  ngOnInit(): void {
    if (!this.auth.hasAnyRole(['ADMIN'])) {
      void this.router.navigate(['/home']);
      return;
    }

    void this.loadUsers();
  }

  selectUser(user: AuthUser): void {
    this.selectedUser = { ...user };
    this.selectedStatus = user.status;
    this.selectedPassword = '';
    this.errorMessage = '';
    this.successMessage = '';
  }

  clearSelection(): void {
    this.selectedUser = null;
    this.selectedPassword = '';
    this.errorMessage = '';
    this.successMessage = '';
  }

  async createUser(): Promise<void> {
    this.errorMessage = '';
    this.successMessage = '';

    const payload: CreateUserInput = {
      username: this.newUsername.trim(),
      displayName: this.newDisplayName.trim() || this.newUsername.trim(),
      password: this.newPassword.trim(),
      roles: [this.newRole],
      status: this.newStatus,
    };

    if (!payload.username || !payload.password) {
      this.errorMessage = 'Username and temporary password are required.';
      return;
    }

    const result = await this.auth.createUser(payload);
    if (!result.success) {
      this.errorMessage = result.error ?? 'Could not create user.';
      return;
    }

    this.successMessage = `Created ${payload.username}.`;
    this.newUsername = '';
    this.newDisplayName = '';
    this.newPassword = '';
    this.newRole = 'FREIGHT_USER';
    this.newStatus = 'ACTIVE';
    await this.loadUsers();
  }

  async saveUser(): Promise<void> {
    if (!this.selectedUser) {
      return;
    }

    if (this.selectedUser.id === this.currentUserId && this.selectedStatus === 'INACTIVE') {
      this.errorMessage = 'You cannot deactivate your own account.';
      return;
    }

    this.errorMessage = '';
    this.successMessage = '';

    const result = await this.auth.updateUser(this.selectedUser.id, {
      status: this.selectedStatus,
      password: this.selectedPassword,
    });

    if (!result.success) {
      this.errorMessage = result.error ?? 'Could not update the user.';
      return;
    }

    this.successMessage = `Updated ${this.selectedUser.username}.`;
    await this.loadUsers();
    const refreshed = this.users.find((user) => user.id === this.selectedUser?.id) ?? null;
    this.selectedUser = refreshed ? { ...refreshed } : null;
    this.selectedPassword = '';
  }

  private async loadUsers(): Promise<void> {
    try {
      this.users = await this.auth.listUsers();
    } catch {
      this.errorMessage = 'Failed to load users.';
    }
  }
}
