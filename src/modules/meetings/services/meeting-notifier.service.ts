import { Injectable, Logger } from '@nestjs/common';

import type { Meeting } from '../schemas/meeting.schema';

/**
 * Where a meeting tells its farmers. Nothing is sent yet: the TL's WhatsApp
 * API plugs in here, and it reaches only the invited attendees — the
 * partner's own customers and leads, who gave consent when they were added
 * (user's decision, 2026-10-15). Until then the app shares by hand.
 */
@Injectable()
export class MeetingNotifier {
  private readonly logger = new Logger(MeetingNotifier.name);

  scheduled(meeting: Meeting): void {
    this.held('scheduled', meeting);
  }

  rescheduled(meeting: Meeting): void {
    this.held('rescheduled', meeting);
  }

  cancelled(meeting: Meeting): void {
    this.held('cancelled', meeting);
  }

  private held(what: string, meeting: Meeting): void {
    this.logger.debug(
      `Meeting ${meeting._id} ${what}: ${meeting.counts.invited} invites not sent (no WhatsApp sender yet)`,
    );
  }
}
