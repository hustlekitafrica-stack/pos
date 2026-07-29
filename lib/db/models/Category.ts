import { Model } from '@nozbe/watermelondb';
import { text, readonly, date, children } from '@nozbe/watermelondb/decorators';

export default class Category extends Model {
  static table = 'categories';

  static associations = {
    products: { type: 'has_many' as const, foreignKey: 'category_id' },
  };

  @text('name') name!: string;
  @text('prep_station') prepStation!: string;
  @children('products') products: any;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
