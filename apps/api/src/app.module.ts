import { Module } from '@nestjs/common';

import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { AccountsModule } from './modules/accounts/accounts.module.js';
import { CategoriesModule } from './modules/categories/categories.module.js';
import { BudgetsModule } from './modules/budgets/budgets.module.js';
import { GoalsModule } from './modules/goals/goals.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { InvoicesModule } from './modules/invoices/invoices.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { DataTransferModule } from './modules/data-transfer/data-transfer.module.js';
import { PlannedModule } from './modules/planned/planned.module.js';
import { PreferencesModule } from './modules/preferences/preferences.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { TransactionsModule } from './modules/transactions/transactions.module.js';

@Module({
  imports: [DatabaseModule, HealthModule, AuthModule, AccountsModule, CategoriesModule, TransactionsModule, InvoicesModule, BudgetsModule, GoalsModule, NotificationsModule, PreferencesModule, DataTransferModule, ReportsModule, PlannedModule],
})
export class AppModule {}
