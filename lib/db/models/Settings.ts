import { Model } from '@nozbe/watermelondb';
import { text, readonly, date } from '@nozbe/watermelondb/decorators';

/**
 * Single global settings row for the venue (id = 'global').
 * Holds venue-wide config that should persist across devices and app reinstalls.
 */
export default class Settings extends Model {
  static table = 'settings';

  @text('alert_email') alertEmail!: string;
  @text('logo_url') logoUrl!: string | null;
  @text('bar_printer_address') barPrinterAddress!: string | null;
  @text('kitchen_printer_address') kitchenPrinterAddress!: string | null;
  @text('venue_name') venueName!: string;
  @readonly @date('created_at') createdAt!: Date;
  @date('updated_at') updatedAt!: Date;
}
