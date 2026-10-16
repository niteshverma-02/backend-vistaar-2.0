import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AgentsModule } from '@modules/agents/agents.module';
import { SpineModule } from '@modules/spine/spine.module';

import { AuthController } from './controllers/auth.controller';
import { OtpAttemptRepository } from './repositories/otp-attempt.repository';
import { SessionRepository } from './repositories/session.repository';
import { OtpAttempt, OtpAttemptSchema } from './schemas/otp-attempt.schema';
import { Session, SessionSchema } from './schemas/session.schema';
import { AuthService } from './services/auth.service';
import { OtpService } from './services/otp.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Session.name, schema: SessionSchema },
      { name: OtpAttempt.name, schema: OtpAttemptSchema },
    ]),
    AgentsModule,
    SpineModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpService, SessionRepository, OtpAttemptRepository],
  // Farmer OTP on lead add (leads module): the same SMS service and limits.
  exports: [OtpService],
})
export class AuthModule {}
