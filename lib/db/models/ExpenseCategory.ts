import { Model } from '@nozbe/watermelondb';
import { text, readonly, date } from '@nozbe/watermelondb/decorators';

export default class ExpenseCategory extends Model {
  static table = 'expense_categories';

  @text('name') name!: string;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
