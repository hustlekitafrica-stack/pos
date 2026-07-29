import { Model } from '@nozbe/watermelondb';
import { field, text, readonly, date } from '@nozbe/watermelondb/decorators';

export default class Device extends Model {
  static table = 'devices';

  @text('name') name!: string;
  @text('device_fingerprint') deviceFingerprint!: string;
  @field('is_approved') isApproved!: boolean;
  @date('registered_at') registeredAt!: Date;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
