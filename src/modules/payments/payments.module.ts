import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AccessModule } from '@modules/access/access.module';
import { AgentsModule } from '@modules/agents/agents.module';
import { OnboardingModule } from '@modules/onboarding/onboarding.module';

import { AdminPaymentCredentialsController } from './controllers/admin-payment-credentials.controller';
import { AdminPaymentOptionsController } from './controllers/admin-payment-options.controller';
import { PaymentOptionsController } from './controllers/payment-options.controller';
import { CredentialCipher } from './providers/credential-cipher';
import { GatewayVerifier } from './providers/gateway-verifier';
import { PaymentAlerts } from './providers/payment-alerts';
import { PaymentCredentialRepository } from './repositories/payment-credential.repository';
import { PaymentOptionRepository } from './repositories/payment-option.repository';
import {
  PaymentCredential,
  PaymentCredentialSchema,
} from './schemas/payment-credential.schema';
import {
  PaymentOptionAudit,
  PaymentOptionAuditSchema,
} from './schemas/payment-option-audit.schema';
import {
  PaymentOption,
  PaymentOptionSchema,
} from './schemas/payment-option.schema';
import { PaymentCredentialsService } from './services/payment-credentials.service';
import { PaymentOptionsService } from './services/payment-options.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PaymentOption.name, schema: PaymentOptionSchema },
      { name: PaymentOptionAudit.name, schema: PaymentOptionAuditSchema },
      { name: PaymentCredential.name, schema: PaymentCredentialSchema },
    ]),
    AccessModule,
    AgentsModule,
    OnboardingModule,
  ],
  controllers: [
    PaymentOptionsController,
    AdminPaymentOptionsController,
    AdminPaymentCredentialsController,
  ],
  providers: [
    PaymentOptionRepository,
    PaymentCredentialRepository,
    CredentialCipher,
    GatewayVerifier,
    PaymentAlerts,
    PaymentCredentialsService,
    PaymentOptionsService,
  ],
  // Phase 2 (taking the payment) reads the keys through `usable()`.
  exports: [PaymentOptionsService, PaymentCredentialsService],
})
export class PaymentsModule {}
