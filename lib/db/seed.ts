import { database } from './index';
import { Staff, RestaurantTable, ExpenseCategory } from './models';
import { hashPin } from '../auth/pin';

/**
 * Seed the database with initial data for first run.
 * Only seeds staff accounts, tables, and expense categories.
 * Categories and products are managed entirely through the Menu screen.
 * Only runs if no staff exist (first-run detection).
 */
export async function seedDatabase() {
  const staffCount = await database.get<Staff>('staff').query().fetchCount();
  if (staffCount > 0) return; // already seeded

  const adminPin = await hashPin('1234');
  const cashierPin = await hashPin('5678');
  const bartenderPin = await hashPin('9012');
  const waiterPin = await hashPin('3456');

  await database.write(async () => {
    // Staff
    await database.get<Staff>('staff').create((s) => {
      s.name = 'Admin';
      s.role = 'admin';
      s.pin = adminPin;
      s.phone = '';
      s.isActive = true;
    });

    await database.get<Staff>('staff').create((s) => {
      s.name = 'Jane (Cashier)';
      s.role = 'cashier';
      s.pin = cashierPin;
      s.phone = '';
      s.isActive = true;
    });

    await database.get<Staff>('staff').create((s) => {
      s.name = 'Mike (Bartender)';
      s.role = 'bartender';
      s.pin = bartenderPin;
      s.phone = '';
      s.isActive = true;
    });

    await database.get<Staff>('staff').create((s) => {
      s.name = 'Sarah (Waiter)';
      s.role = 'waiter';
      s.pin = waiterPin;
      s.phone = '';
      s.isActive = true;
    });

    // Tables
    const tableNames = [
      'Table 1', 'Table 2', 'Table 3', 'Table 4', 'Table 5', 'Table 6',
      'Bar Seat 1', 'Bar Seat 2', 'Bar Seat 3', 'Bar Seat 4',
    ];

    for (const name of tableNames) {
      await database.get<RestaurantTable>('restaurant_tables').create((t) => {
        t.name = name;
        t.status = 'free';
      });
    }

    // Expense Categories
    const expCats = ['Supplies/Stock', 'Salaries', 'Utilities', 'Rent', 'Transport', 'Maintenance', 'Other'];
    for (const name of expCats) {
      await database.get<ExpenseCategory>('expense_categories').create((e) => {
        e.name = name;
      });
    }
  });

  console.log('✅ Database seeded');
}
