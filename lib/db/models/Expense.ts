import { Model } from '@nozbe/watermelondb';
import { field, text, readonly, date, relation } from '@nozbe/watermelondb/decorators';

export default class Expense extends Model {
  static table = 'expenses';

  static associations = {
    expense_categories: { type: 'belongs_to' as const, key: 'category_id' },
  };

  @text('category_id') categoryId!: string;
  @text('description') description!: string;
  @field('amount') amount!: number;
  @text('paid_by') paidBy!: string;
  @text('logged_by') loggedBy!: string;
  @text('date') expenseDate!: string;
  @text('receipt_photo_url') receiptPhotoUrl!: string | null;
  @text('source') source!: string;
  @text('vendor_name') vendorName!: string | null;
  @relation('expense_categories', 'category_id') category: any;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
