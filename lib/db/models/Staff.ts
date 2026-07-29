import { Model } from '@nozbe/watermelondb';
import { field, text, readonly, date } from '@nozbe/watermelondb/decorators';

export default class Staff extends Model {
  static table = 'staff';

  @text('name') name!: string;
  @text('role') role!: string;
  @text('pin') pin!: string;
  @text('phone') phone!: string;
  @field('is_active') isActive!: boolean;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
