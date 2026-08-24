import { Q } from '@nozbe/watermelondb';
import { database } from './index';
import { Staff, Category, Product, RestaurantTable, Order, OrderItem, Payment, Shift, AuditLog } from './models';
import { hashPin, verifyPin } from '../auth/pin';
import { triggerAutoSync } from './sync';

// ─── Auth ───────────────────────────────────────────────────────────────────

export async function findStaffByPin(enteredPin: string): Promise<Staff | null> {
  const allStaff = await database.get<Staff>('staff').query(Q.where('is_active', true)).fetch();
  for (const s of allStaff) {
    const match = await verifyPin(enteredPin, s.pin);
    if (match) return s;
  }
  return null;
}

export async function deleteStaff(id: string): Promise<void> {
  await database.write(async () => {
    const staff = await database.get<Staff>('staff').find(id);
    await staff.destroyPermanently();
  });
  triggerAutoSync();
}

// ─── Categories ─────────────────────────────────────────────────────────────

export async function getAllCategories(): Promise<Category[]> {
  return database.get<Category>('categories').query().fetch();
}

export async function createCategory(name: string, prepStation: string): Promise<Category> {
  const result = await database.write(async () => {
    return database.get<Category>('categories').create((c) => {
      c.name = name;
      c.prepStation = prepStation;
    });
  });
  triggerAutoSync();
  return result;
}

export async function updateCategory(id: string, name: string, prepStation: string): Promise<void> {
  await database.write(async () => {
    const cat = await database.get<Category>('categories').find(id);
    await cat.update((c) => {
      c.name = name;
      c.prepStation = prepStation;
    });
  });
  triggerAutoSync();
}

export async function deleteCategory(id: string): Promise<void> {
  await database.write(async () => {
    const products = await database.get<Product>('products').query(Q.where('category_id', id)).fetch();
    for (const p of products) {
      await p.destroyPermanently();
    }
    const cat = await database.get<Category>('categories').find(id);
    await cat.destroyPermanently();
  });
  triggerAutoSync();
}

// ─── Products ───────────────────────────────────────────────────────────────

export async function getProductsByCategory(categoryId: string): Promise<Product[]> {
  return database
    .get<Product>('products')
    .query(Q.where('category_id', categoryId), Q.where('is_active', true))
    .fetch();
}

export async function getProductsByStation(station: string): Promise<Product[]> {
  // Fetch all categories for this prep station, then fetch all active products in them
  const cats = await database
    .get<Category>('categories')
    .query(Q.where('prep_station', station))
    .fetch();
  if (cats.length === 0) return [];
  const catIds = cats.map((c) => c.id);
  return database
    .get<Product>('products')
    .query(Q.where('category_id', Q.oneOf(catIds)), Q.where('is_active', true))
    .fetch();
}

export async function getAllActiveProducts(): Promise<Product[]> {
  return database
    .get<Product>('products')
    .query(Q.where('is_active', true))
    .fetch();
}

export async function createProduct(data: {
  name: string;
  categoryId: string;
  price: number;
  costPrice: number;
  stockQty: number;
  unit: string;
}): Promise<Product> {
  const result = await database.write(async () => {
    return database.get<Product>('products').create((p) => {
      p.name = data.name;
      p.categoryId = data.categoryId;
      p.price = data.price;
      p.costPrice = data.costPrice;
      p.stockQty = data.stockQty;
      p.unit = data.unit;
      p.lowStockThreshold = 5;
      p.lowStockAlertSent = false;
      p.isOutOfStock = false;
      p.isActive = true;
    });
  });
  triggerAutoSync();
  return result;
}

export async function updateProduct(
  id: string,
  data: Partial<{ name: string; price: number; costPrice: number; unit: string; isActive: boolean }>
): Promise<void> {
  await database.write(async () => {
    const prod = await database.get<Product>('products').find(id);
    await prod.update((p) => {
      if (data.name !== undefined) p.name = data.name;
      if (data.price !== undefined) p.price = data.price;
      if (data.costPrice !== undefined) p.costPrice = data.costPrice;
      if (data.unit !== undefined) p.unit = data.unit;
      if (data.isActive !== undefined) p.isActive = data.isActive;
    });
  });
  triggerAutoSync();
}

// ─── Tables ─────────────────────────────────────────────────────────────────

export async function getAllTables(): Promise<RestaurantTable[]> {
  return database.get<RestaurantTable>('restaurant_tables').query().fetch();
}

export async function createTable(name: string): Promise<RestaurantTable> {
  const result = await database.write(async () => {
    return database.get<RestaurantTable>('restaurant_tables').create((t) => {
      t.name = name;
      t.status = 'free';
    });
  });
  triggerAutoSync();
  return result;
}

export async function updateTableStatus(id: string, status: string): Promise<void> {
  await database.write(async () => {
    const tbl = await database.get<RestaurantTable>('restaurant_tables').find(id);
    await tbl.update((t) => {
      t.status = status;
    });
  });
  triggerAutoSync();
}

// ─── Orders ─────────────────────────────────────────────────────────────────

export async function createOrder(data: {
  tableId: string;
  staffId: string;
  shiftId: string;
  deviceId: string;
  roomNumber?: string;
}): Promise<Order> {
  const result = await database.write(async () => {
    const order = await database.get<Order>('orders').create((o) => {
      o.tableId = data.tableId;
      o.staffId = data.staffId;
      o.shiftId = data.shiftId;
      o.deviceId = data.deviceId;
      o.roomNumber = data.roomNumber || null;
      o.customerId = null;
      o.isCredit = false;
      o.status = 'open';
      o.openedAt = new Date();
      o.discountAmount = 0;
      o.discountReason = null;
      o.totalAmount = 0;
    });

    // Update table status
    const tbl = await database.get<RestaurantTable>('restaurant_tables').find(data.tableId);
    await tbl.update((t) => {
      t.status = 'open';
    });

    return order;
  });
  triggerAutoSync();
  return result;
}

export async function getActiveOrderForTable(tableId: string): Promise<Order | null> {
  const orders = await database
    .get<Order>('orders')
    .query(
      Q.where('table_id', tableId),
      Q.where('status', Q.notIn(['paid', 'closed', 'voided']))
    )
    .fetch();
  return orders.length > 0 ? orders[0] : null;
}

export async function getOrderItems(orderId: string): Promise<OrderItem[]> {
  return database
    .get<OrderItem>('order_items')
    .query(Q.where('order_id', orderId))
    .fetch();
}

export async function addItemToOrder(data: {
  orderId: string;
  productId: string;
  qty: number;
  unitPrice: number;
  notes?: string;
}): Promise<OrderItem> {
  const item = await database.write(async () => {
    return database.get<OrderItem>('order_items').create((i) => {
      i.orderId = data.orderId;
      i.productId = data.productId;
      i.qty = data.qty;
      i.unitPrice = data.unitPrice;
      i.notes = data.notes || null;
      i.status = 'pending';
      i.isComplimentary = false;
      i.compReason = null;
      i.compAuthorizedBy = null;
      i.voided = false;
      i.voidReason = null;
      i.voidedBy = null;
    });
  });

  // Recalculate order total AFTER the write commits so the query sees the new item
  await recalculateOrderTotal(data.orderId);
  triggerAutoSync();
  return item;
}

export async function recalculateOrderTotal(orderId: string): Promise<void> {
  const items = await database
    .get<OrderItem>('order_items')
    .query(Q.where('order_id', orderId), Q.where('voided', false))
    .fetch();

  let total = 0;
  for (const item of items) {
    if (!item.isComplimentary) {
      total += item.unitPrice * item.qty;
    }
  }

  const order = await database.get<Order>('orders').find(orderId);
  await database.write(async () => {
    await order.update((o) => {
      o.totalAmount = Math.max(0, total - o.discountAmount);
    });
  });
}

export async function sendOrder(orderId: string): Promise<void> {
  await database.write(async () => {  // eslint-disable-line
    const order = await database.get<Order>('orders').find(orderId);
    const items = await database
      .get<OrderItem>('order_items')
      .query(Q.where('order_id', orderId), Q.where('status', 'pending'))
      .fetch();

    // Deduct stock for each pending item
    for (const item of items) {
      const product = await database.get<Product>('products').find(item.productId);
      await product.update((p) => {
        p.stockQty = Math.max(0, p.stockQty - item.qty);
        if (p.stockQty <= p.lowStockThreshold) {
          // Flag for low stock alert
        }
        if (p.stockQty === 0) {
          p.isOutOfStock = true;
        }
      });

      // Update item status to sent
      await item.update((i) => {
        i.status = 'sent';
      });
    }

    // Update order status
    await order.update((o) => {
      o.status = 'sent';
    });
  });
  triggerAutoSync();
}

export async function markOrderServed(orderId: string): Promise<void> {
  await database.write(async () => {
    const order = await database.get<Order>('orders').find(orderId);
    await order.update((o) => {
      o.status = 'served';
    });

    const items = await database
      .get<OrderItem>('order_items')
      .query(Q.where('order_id', orderId), Q.where('status', 'sent'))
      .fetch();

    for (const item of items) {
      await item.update((i) => {
        i.status = 'served';
      });
    }
  });
}

export async function voidOrderItem(
  itemId: string,
  reason: string,
  voidedByStaffId: string
): Promise<void> {
  await database.write(async () => {
    const item = await database.get<OrderItem>('order_items').find(itemId);

    // If item was already sent, restore stock
    if (item.status === 'sent' || item.status === 'preparing' || item.status === 'served') {
      const product = await database.get<Product>('products').find(item.productId);
      await product.update((p) => {
        p.stockQty += item.qty;
        if (p.stockQty > 0) {
          p.isOutOfStock = false;
        }
      });
    }

    await item.update((i) => {
      i.voided = true;
      i.voidReason = reason;
      i.voidedBy = voidedByStaffId;
      i.status = 'voided';
    });

    // Recalculate order total
    await recalculateOrderTotal(item.orderId);
  });
  triggerAutoSync();
}

export async function reduceOrderItem(
  orderId: string,
  productId: string,
  staffId: string
): Promise<void> {
  const pending = await database
    .get<OrderItem>('order_items')
    .query(
      Q.where('order_id', orderId),
      Q.where('product_id', productId),
      Q.where('voided', false),
      Q.where('status', 'pending')
    )
    .fetch();
  if (pending.length === 0) return;
  const item = pending[pending.length - 1]; // remove the most-recently added
  if (item.qty > 1) {
    await database.write(async () => {
      await item.update((i) => { i.qty = i.qty - 1; });
    });
    await recalculateOrderTotal(orderId);
  } else {
    await database.write(async () => {
      await item.update((i) => {
        i.voided = true;
        i.voidReason = 'Removed from order';
        i.voidedBy = staffId;
        i.status = 'voided';
      });
    });
    await recalculateOrderTotal(orderId);
  }
  triggerAutoSync();
}

// ─── Payments ───────────────────────────────────────────────────────────────

export async function recordPayment(data: {
  orderId: string;
  method: string;
  amount: number;
  mpesaRef?: string;
}): Promise<Payment> {
  const result = await database.write(async () => {
    const payment = await database.get<Payment>('payments').create((p) => {
      p.orderId = data.orderId;
      p.method = data.method;
      p.amount = data.amount;
      p.mpesaRef = data.mpesaRef || null;
      p.paidAt = new Date();
    });

    // Check if order is fully paid
    const allPayments = await database
      .get<Payment>('payments')
      .query(Q.where('order_id', data.orderId))
      .fetch();

    const totalPaid = allPayments.reduce((sum, p) => sum + p.amount, 0);
    const order = await database.get<Order>('orders').find(data.orderId);

    if (totalPaid >= order.totalAmount) {
      await order.update((o) => {
        o.status = 'paid';
        o.closedAt = new Date();
      });

      // Free the table
      const tbl = await database.get<RestaurantTable>('restaurant_tables').find(order.tableId);
      await tbl.update((t) => {
        t.status = 'free';
      });
    } else {
      await order.update((o) => {
        o.status = 'served';
      });

      // Mark table as awaiting payment
      const tbl = await database.get<RestaurantTable>('restaurant_tables').find(order.tableId);
      await tbl.update((t) => {
        t.status = 'awaiting_payment';
      });
    }

    return payment;
  });
  triggerAutoSync();
  return result;
}

// ─── Split / Merge Orders ────────────────────────────────────────────────────

export async function splitOrder(
  originalOrderId: string,
  itemIdsToSplit: string[]
): Promise<Order> {
  const original = await database.get<Order>('orders').find(originalOrderId);

  const newOrder = await database.write(async () => {
    return database.get<Order>('orders').create((o) => {
      o.tableId = original.tableId;
      o.staffId = original.staffId;
      o.shiftId = original.shiftId;
      o.deviceId = original.deviceId;
      o.roomNumber = original.roomNumber;
      o.customerId = null;
      o.isCredit = false;
      o.status = original.status;
      o.openedAt = new Date();
      o.discountAmount = 0;
      o.discountReason = null;
      o.totalAmount = 0;
    });
  });

  await database.write(async () => {
    for (const itemId of itemIdsToSplit) {
      const item = await database.get<OrderItem>('order_items').find(itemId);
      await item.update((i) => { i.orderId = newOrder.id; });
    }
  });

  await recalculateOrderTotal(originalOrderId);
  await recalculateOrderTotal(newOrder.id);
  triggerAutoSync();
  return newOrder;
}

export async function mergeOrders(
  sourceOrderId: string,
  targetOrderId: string
): Promise<void> {
  const items = await database
    .get<OrderItem>('order_items')
    .query(Q.where('order_id', sourceOrderId))
    .fetch();

  await database.write(async () => {
    for (const item of items) {
      await item.update((i) => { i.orderId = targetOrderId; });
    }
    const source = await database.get<Order>('orders').find(sourceOrderId);
    await source.update((o) => {
      o.status = 'closed';
      o.closedAt = new Date();
    });
  });

  await recalculateOrderTotal(targetOrderId);
  triggerAutoSync();
}

// ─── Shifts ─────────────────────────────────────────────────────────────────

export async function openShift(staffId: string, openingCash: number): Promise<Shift> {
  const result = await database.write(async () => {
    return database.get<Shift>('shifts').create((s) => {
      s.staffId = staffId;
      s.openedAt = new Date();
      s.openingCash = openingCash;
      s.status = 'open';
    });
  });
  triggerAutoSync();
  return result;
}

export async function getActiveShift(staffId: string): Promise<Shift | null> {
  const shifts = await database
    .get<Shift>('shifts')
    .query(Q.where('staff_id', staffId), Q.where('closed_at', null))
    .fetch();
  return shifts.length > 0 ? shifts[0] : null;
}

export async function closeShift(shiftId: string, closingCashActual: number): Promise<void> {
  await database.write(async () => {
    // Check for open orders in this shift
    const openOrders = await database
      .get<Order>('orders')
      .query(
        Q.where('shift_id', shiftId),
        Q.where('status', Q.notIn(['paid', 'closed', 'voided']))
      )
      .fetch();

    if (openOrders.length > 0) {
      throw new Error(`Cannot close shift: ${openOrders.length} open order(s) remain`);
    }

    // Calculate expected cash from cash payments in this shift
    const shiftOrders = await database
      .get<Order>('orders')
      .query(Q.where('shift_id', shiftId))
      .fetch();

    const orderIds = shiftOrders.map((o) => o.id);
    let cashTotal = 0;

    if (orderIds.length > 0) {
      const payments = await database
        .get<Payment>('payments')
        .query(Q.where('order_id', Q.oneOf(orderIds)), Q.where('method', 'cash'))
        .fetch();
      cashTotal = payments.reduce((sum, p) => sum + p.amount, 0);
    }

    const shift = await database.get<Shift>('shifts').find(shiftId);
    const expectedCash = shift.openingCash + cashTotal;

    await shift.update((s) => {
      s.closedAt = new Date();
      s.closingCashExpected = expectedCash;
      s.closingCashActual = closingCashActual;
      s.variance = closingCashActual - expectedCash;
      s.status = 'closed';
    });
  });
  triggerAutoSync();
}

export async function getShiftSummary(shiftId: string): Promise<{
  cashTotal: number; mpesaTotal: number; cardTotal: number; creditTotal: number;
  totalRevenue: number; orderCount: number; openOrders: Order[];
}> {
  const shiftOrders = await database.get<Order>('orders').query(Q.where('shift_id', shiftId)).fetch();
  const openOrders = shiftOrders.filter((o) => !['paid', 'closed', 'voided'].includes(o.status));
  const paidOrders = shiftOrders.filter((o) => ['paid', 'closed'].includes(o.status));
  const orderIds = paidOrders.map((o) => o.id);
  let cashTotal = 0; let mpesaTotal = 0; let cardTotal = 0; let creditTotal = 0;
  if (orderIds.length > 0) {
    const payments = await database.get<Payment>('payments').query(Q.where('order_id', Q.oneOf(orderIds))).fetch();
    for (const p of payments) {
      if (p.method === 'cash') cashTotal += p.amount;
      else if (p.method === 'mpesa') mpesaTotal += p.amount;
      else if (p.method === 'card') cardTotal += p.amount;
      else if (p.method === 'credit') creditTotal += p.amount;
    }
  }
  return {
    cashTotal, mpesaTotal, cardTotal, creditTotal,
    totalRevenue: cashTotal + mpesaTotal + cardTotal + creditTotal,
    orderCount: paidOrders.length,
    openOrders,
  };
}

export async function requestShiftClosure(shiftId: string): Promise<void> {
  const openOrders = await database.get<Order>('orders')
    .query(Q.where('shift_id', shiftId), Q.where('status', Q.notIn(['paid', 'closed', 'voided'])))
    .fetch();
  if (openOrders.length > 0) {
    throw new Error(`You have ${openOrders.length} open/unpaid order(s). Close all bills before ending your shift.`);
  }
  await database.write(async () => {
    const shift = await database.get<Shift>('shifts').find(shiftId);
    await shift.update((s) => { s.status = 'pending_approval'; });
  });
  triggerAutoSync();
}

export async function approveShiftClosure(
  shiftId: string,
  approverId: string,
  closingCashActual: number,
  notes?: string
): Promise<void> {
  await database.write(async () => {
    const shiftOrders = await database.get<Order>('orders').query(Q.where('shift_id', shiftId)).fetch();
    const orderIds = shiftOrders.map((o) => o.id);
    let cashTotal = 0;
    if (orderIds.length > 0) {
      const payments = await database.get<Payment>('payments')
        .query(Q.where('order_id', Q.oneOf(orderIds)), Q.where('method', 'cash'))
        .fetch();
      cashTotal = payments.reduce((sum, p) => sum + p.amount, 0);
    }
    const shift = await database.get<Shift>('shifts').find(shiftId);
    const expectedCash = shift.openingCash + cashTotal;
    await shift.update((s) => {
      s.closedAt = new Date();
      s.closingCashExpected = expectedCash;
      s.closingCashActual = closingCashActual;
      s.variance = closingCashActual - expectedCash;
      s.status = 'closed';
      s.approvedBy = approverId;
      s.approvedAt = new Date();
      s.closureNotes = notes ?? null;
    });
  });
  triggerAutoSync();
}

export async function getPendingShifts(): Promise<Array<{ shift: Shift; staffName: string }>> {
  const shifts = await database.get<Shift>('shifts').query(Q.where('status', 'pending_approval')).fetch();
  const staffList = await database.get<Staff>('staff').query().fetch();
  const nameMap: Record<string, string> = {};
  for (const s of staffList) nameMap[s.id] = s.name;
  return shifts.map((shift) => ({ shift, staffName: nameMap[shift.staffId] ?? 'Unknown' }));
}

// ─── Audit Log ──────────────────────────────────────────────────────────────

export async function logAudit(data: {
  action: string;
  entityType: string;
  entityId: string;
  staffId: string;
  deviceId: string;
  details: Record<string, unknown>;
}): Promise<void> {
  await database.write(async () => {
    await database.get<AuditLog>('audit_log').create((a) => {
      a.action = data.action;
      a.entityType = data.entityType;
      a.entityId = data.entityId;
      a.staffId = data.staffId;
      a.deviceId = data.deviceId;
      a.details = JSON.stringify(data.details);
    });
  });
}
