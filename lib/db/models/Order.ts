import { Model } from '@nozbe/watermelondb';
import { field, text, readonly, date, relation, children } from '@nozbe/watermelondb/decorators';

export default class Order extends Model {
  static table = 'orders';

  static associations = {
    restaurant_tables: { type: 'belongs_to' as const, key: 'table_id' },
    staff: { type: 'belongs_to' as const, key: 'staff_id' },
    shifts: { type: 'belongs_to' as const, key: 'shift_id' },
    order_items: { type: 'has_many' as const, foreignKey: 'order_id' },
    payments: { type: 'has_many' as const, foreignKey: 'order_id' },
  };

  @text('table_id') tableId!: string;
  @text('staff_id') staffId!: string;
  @text('shift_id') shiftId!: string;
  @text('device_id') deviceId!: string;
  @text('customer_id') customerId!: string | null;
  @field('is_credit') isCredit!: boolean;
  @text('room_number') roomNumber!: string | null;
  @text('status') status!: string;
  @date('opened_at') openedAt!: Date;
  @date('closed_at') closedAt!: Date | null;
  @field('discount_amount') discountAmount!: number;
  @text('discount_reason') discountReason!: string | null;
  @field('total_amount') totalAmount!: number;
  @relation('restaurant_tables', 'table_id') restaurantTable: any;
  @relation('staff', 'staff_id') staffMember: any;
  @relation('shifts', 'shift_id') shift: any;
  @children('order_items') items: any;
  @children('payments') payments: any;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
