import { Model } from '@nozbe/watermelondb';
import { field, text, readonly, date, relation } from '@nozbe/watermelondb/decorators';

export default class Refund extends Model {
  static table = 'refunds';

  static associations = {
    payments: { type: 'belongs_to' as const, key: 'payment_id' },
  };

  @text('payment_id') paymentId!: string;
  @field('amount') amount!: number;
  @text('reason') reason!: string;
  @text('authorized_by') authorizedBy!: string;
  @relation('payments', 'payment_id') payment: any;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
