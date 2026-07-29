import { Model } from '@nozbe/watermelondb';
import { field, text, readonly, date, children } from '@nozbe/watermelondb/decorators';

export default class Customer extends Model {
  static table = 'customers';

  static associations = {
    credit_transactions: { type: 'has_many' as const, foreignKey: 'customer_id' },
  };

  @text('name') name!: string;
  @text('phone') phone!: string | null;
  @field('credit_limit') creditLimit!: number;
  @field('is_active') isActive!: boolean;
  @text('notes') notes!: string | null;
  @text('created_by') createdBy!: string;
  @children('credit_transactions') creditTransactions: any;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
