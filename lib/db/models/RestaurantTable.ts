import { Model } from '@nozbe/watermelondb';
import { text, readonly, date, children } from '@nozbe/watermelondb/decorators';

export default class RestaurantTable extends Model {
  static table = 'restaurant_tables';

  static associations = {
    orders: { type: 'has_many' as const, foreignKey: 'table_id' },
  };

  @text('name') name!: string;
  @text('status') status!: string;
  @children('orders') orders: any;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
