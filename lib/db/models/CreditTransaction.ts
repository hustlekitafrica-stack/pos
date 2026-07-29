import { Model } from '@nozbe/watermelondb';
import { field, text, readonly, date, relation } from '@nozbe/watermelondb/decorators';

export default class CreditTransaction extends Model {
  static table = 'credit_transactions';

  static associations = {
    customers: { type: 'belongs_to' as const, key: 'customer_id' },
  };

  @text('customer_id') customerId!: string;
  @text('order_id') orderId!: string | null;
  @text('type') type!: string;
  @field('amount') amount!: number;
  @text('payment_method') paymentMethod!: string | null;
  @text('mpesa_ref') mpesaRef!: string | null;
  @text('notes') notes!: string | null;
  @text('recorded_by') recordedBy!: string;
  @relation('customers', 'customer_id') customer: any;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
