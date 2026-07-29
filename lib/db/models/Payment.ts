import { Model } from '@nozbe/watermelondb';
import { field, text, readonly, date, relation } from '@nozbe/watermelondb/decorators';

export default class Payment extends Model {
  static table = 'payments';

  static associations = {
    orders: { type: 'belongs_to' as const, key: 'order_id' },
  };

  @text('order_id') orderId!: string;
  @text('method') method!: string;
  @field('amount') amount!: number;
  @text('mpesa_ref') mpesaRef!: string | null;
  @date('paid_at') paidAt!: Date;
  @relation('orders', 'order_id') order: any;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
