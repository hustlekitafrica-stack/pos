import { database } from './index';
import { Staff, Category, RestaurantTable, ExpenseCategory } from './models';
import { hashPin } from '../auth/pin';

/**
 * Seed the database with initial data for development/first run.
 * Only seeds if no staff exist (first run detection).
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

    // Categories
    const beers = await database.get<Category>('categories').create((c) => {
      c.name = 'Beers';
      c.prepStation = 'bar';
    });

    const spirits = await database.get<Category>('categories').create((c) => {
      c.name = 'Spirits';
      c.prepStation = 'bar';
    });

    const softDrinks = await database.get<Category>('categories').create((c) => {
      c.name = 'Soft Drinks';
      c.prepStation = 'bar';
    });

    const food = await database.get<Category>('categories').create((c) => {
      c.name = 'Food';
      c.prepStation = 'kitchen';
    });

    // Products
    const products = [
      { name: 'Tusker Lager', categoryId: beers.id, price: 25000, costPrice: 17000, unit: 'bottle', stock: 48 },
      { name: 'White Cap', categoryId: beers.id, price: 25000, costPrice: 17000, unit: 'bottle', stock: 36 },
      { name: 'Guinness', categoryId: beers.id, price: 30000, costPrice: 22000, unit: 'bottle', stock: 24 },
      { name: 'Smirnoff Vodka (Tot)', categoryId: spirits.id, price: 15000, costPrice: 8000, unit: 'tot', stock: 100 },
      { name: 'Jameson (Tot)', categoryId: spirits.id, price: 30000, costPrice: 18000, unit: 'tot', stock: 60 },
      { name: 'Coca Cola', categoryId: softDrinks.id, price: 10000, costPrice: 6000, unit: 'bottle', stock: 72 },
      { name: 'Water 500ml', categoryId: softDrinks.id, price: 5000, costPrice: 2500, unit: 'bottle', stock: 100 },
      { name: 'Nyama Choma (500g)', categoryId: food.id, price: 80000, costPrice: 45000, unit: 'plate', stock: 20 },
      { name: 'Chips', categoryId: food.id, price: 20000, costPrice: 8000, unit: 'plate', stock: 30 },
      { name: 'Ugali + Fish', categoryId: food.id, price: 50000, costPrice: 25000, unit: 'plate', stock: 15 },
    ];

    for (const p of products) {
      await database.get('products').create((prod: any) => {
        prod.name = p.name;
        prod.categoryId = p.categoryId;
        prod.price = p.price;
        prod.costPrice = p.costPrice;
        prod.stockQty = p.stock;
        prod.unit = p.unit;
        prod.lowStockThreshold = 5;
        prod.lowStockAlertSent = false;
        prod.isOutOfStock = false;
        prod.isActive = true;
      });
    }

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

  console.log('✅ Database seeded with initial data');
}
