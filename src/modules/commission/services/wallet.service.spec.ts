import type { AgentsService } from '@modules/agents/services/agents.service';
import type { CountersService } from '@modules/counters/services/counters.service';
import type {
  OnboardingService,
  PayoutFacts,
} from '@modules/onboarding/services/onboarding.service';
import type { StorageService } from '@modules/uploads/services/storage.service';

import type { Book } from '../commission.domain';
import type { TdsCertificateRepository } from '../repositories/tds-certificate.repository';
import type {
  WithdrawalRecord,
  WithdrawalRepository,
} from '../repositories/withdrawal.repository';
import type {
  CommissionService,
  PartnerBook,
  PartnerTerms,
} from './commission.service';
import { csvCell, WalletService } from './wallet.service';

const PARTNER: PartnerTerms = {
  agent_ref: 'ref-1',
  agent_id: 'VST-000001',
  pii_id: 'PII-9',
  name: 'Suresh',
  cohort: 'vistaar_agent',
  stage: 'approved',
  is_active: true,
  monthly_target: 100_000,
};

const SETTINGS = {
  min_withdrawal: 500,
  tds_rate_with_pan: 2,
  tds_rate_without_pan: 20,
} as PartnerBook['settings'];

function withdrawal(
  overrides: Partial<WithdrawalRecord> = {},
): WithdrawalRecord {
  return {
    _id: 'WD-000001',
    agent_id: 'VST-000001',
    amount: 1_000,
    status: 'requested',
    open: true,
    tds_rate: 2,
    tds_amount: 20,
    net_amount: 980,
    account_last4: '4321',
    requested_at: new Date('2026-10-14T05:00:00Z'),
    approved_at: null,
    approved_by: null,
    paid_at: null,
    paid_by: null,
    utr: null,
    rejected_at: null,
    rejected_by: null,
    rejection_reason: null,
    cancelled_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('WalletService', () => {
  let book: Partial<Book>;
  let partner: PartnerTerms;
  let facts: PayoutFacts;
  let repo: jest.Mocked<WithdrawalRepository>;
  let commission: jest.Mocked<CommissionService>;
  let service: WalletService;

  beforeEach(() => {
    book = {
      earned: 3_000,
      paid: 1_000,
      open: 0,
      withdrawable: 2_000,
      totals: { confirmed: { count: 2, amount: 2_000 } } as Book['totals'],
    };
    partner = { ...PARTNER };
    facts = {
      pan_number: 'ABCDE1234F',
      pan_verified: true,
      bank_verified: true,
      bank_change_pending: false,
      bank_account: {
        account_holder: 'Suresh Kumar',
        account_number: '000123454321',
        ifsc: 'SBIN0001234',
      },
    };
    repo = {
      insert: jest.fn().mockResolvedValue(true),
      findById: jest.fn().mockResolvedValue(withdrawal()),
      forAgent: jest.fn().mockResolvedValue([]),
      transition: jest.fn(),
      all: jest.fn().mockResolvedValue([]),
      list: jest.fn(),
    } as unknown as jest.Mocked<WithdrawalRepository>;

    commission = {
      forget: jest.fn(),
      forgetWithdrawals: jest.fn(),
      partner: jest.fn(() => Promise.resolve(partner)),
      bookOf: jest.fn(() =>
        Promise.resolve({
          partner,
          book,
          settings: SETTINGS,
          withdrawals: [],
        }),
      ),
    } as unknown as jest.Mocked<CommissionService>;
    const onboarding = {
      payoutFacts: jest.fn(() => Promise.resolve(new Map([['ref-1', facts]]))),
    } as unknown as OnboardingService;
    const agents = {
      list: jest.fn().mockResolvedValue({
        items: [
          {
            _id: 'ref-1',
            agent_id: 'VST-000001',
            profile: { name: '=HYPERLINK("x")' },
            phone: '9000000001',
            cohort: 'vistaar_agent',
          },
        ],
        total: 1,
      }),
    } as unknown as AgentsService;
    const counters = {
      nextWithdrawalId: jest.fn().mockResolvedValue('WD-000007'),
    } as unknown as CountersService;

    service = new WalletService(
      repo,
      {} as TdsCertificateRepository,
      commission,
      onboarding,
      agents,
      counters,
      {} as StorageService,
    );
  });

  describe('request', () => {
    it('holds the amount with TDS at 2% for a verified PAN, 20% without', async () => {
      const view = await service.request('vst-000001', { amount: 970 });
      expect(view).toMatchObject({
        id: 'WD-000007',
        status: 'requested',
        tds_rate: 2,
        tds_amount: 19.4,
        net_amount: 950.6,
        account_last4: '4321',
      });
      expect(repo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ agent_id: 'VST-000001', open: true }),
      );

      facts.pan_verified = false;
      await expect(
        service.request('VST-000001', { amount: 1_000 }),
      ).resolves.toMatchObject({ tds_rate: 20, net_amount: 800 });
    });

    it('refuses below the minimum, above the balance, or with one already open', async () => {
      await expect(
        service.request('VST-000001', { amount: 499 }),
      ).rejects.toMatchObject({ response: { error: 'BELOW_MIN_WITHDRAWAL' } });
      await expect(
        service.request('VST-000001', { amount: 2_001 }),
      ).rejects.toMatchObject({
        status: 409,
        response: { error: 'NOT_ENOUGH_BALANCE' },
      });

      book.open = 600;
      await expect(
        service.request('VST-000001', { amount: 500 }),
      ).rejects.toMatchObject({ response: { error: 'WITHDRAWAL_OPEN' } });

      // Lost the race to another instance: the unique index answers.
      book.open = 0;
      repo.insert.mockResolvedValueOnce(false);
      await expect(
        service.request('VST-000001', { amount: 500 }),
      ).rejects.toMatchObject({ response: { error: 'WITHDRAWAL_OPEN' } });
    });

    it('needs an approved partner with a verified bank account', async () => {
      facts.bank_verified = false;
      await expect(
        service.request('VST-000001', { amount: 500 }),
      ).rejects.toMatchObject({ response: { error: 'BANK_NOT_VERIFIED' } });

      partner.stage = 'blocked';
      await expect(
        service.request('VST-000001', { amount: 500 }),
      ).rejects.toMatchObject({
        status: 403,
        response: { error: 'PARTNER_NOT_APPROVED' },
      });
      expect(repo.insert).not.toHaveBeenCalled();
    });
  });

  describe('payout cap and pre-check', () => {
    it("caps one request at HO's % of the withdrawable balance", async () => {
      // withdrawable 2,000, cap 50% → most 1,000 in one request.
      commission.bookOf.mockResolvedValue({
        partner,
        book,
        settings: { ...SETTINGS, max_withdrawal_pct: 50 },
        withdrawals: [],
      } as never);
      await expect(
        service.request('VST-000001', { amount: 1_500 }),
      ).rejects.toMatchObject({
        status: 409,
        response: { error: 'ABOVE_WITHDRAWAL_CAP' },
      });
      await expect(service.check('VST-000001', 1_500)).rejects.toMatchObject({
        response: { error: 'ABOVE_WITHDRAWAL_CAP' },
      });
      await expect(service.check('VST-000001', 1_000)).resolves.toMatchObject({
        ok: true,
        max_amount: 1_000,
        tds_rate: 2,
        tds_amount: 20,
        net_amount: 980,
      });
      expect(repo.insert).not.toHaveBeenCalled();
    });

    it('eligibility reports the band, and the reason when blocked', async () => {
      await expect(service.eligibility('VST-000001')).resolves.toMatchObject({
        eligible: true,
        min_amount: 500,
        max_amount: 2_000,
        account_last4: '4321',
      });
      partner.stage = 'blocked';
      await expect(service.eligibility('VST-000001')).resolves.toMatchObject({
        eligible: false,
        blocked_reason: 'not_approved',
      });
    });
  });

  it('refuses a new withdrawal while a bank account change waits for HO', async () => {
    facts.bank_change_pending = true;
    await expect(
      service.request('VST-000001', { amount: 500 }),
    ).rejects.toMatchObject({
      status: 409,
      response: { error: 'BANK_CHANGE_PENDING' },
    });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  describe('approve', () => {
    it('counts the request itself as available, fixes the TDS rate, and moves it on', async () => {
      // ₹1,000 open: unpaid 2,000 − open 1,000 leaves 1,000 to spare.
      book.open = 1_000;
      facts.pan_verified = false;
      repo.transition.mockResolvedValue(withdrawal({ status: 'approved' }));
      await service.approve('WD-000001', 'ho@k.com');
      expect(repo.transition).toHaveBeenCalledWith(
        'WD-000001',
        ['requested'],
        'approved',
        expect.objectContaining({
          approved_by: 'ho@k.com',
          tds_rate: 20,
          tds_amount: 200,
          net_amount: 800,
        }),
      );
    });

    it('refuses when the balance has fallen below the request', async () => {
      book.totals!.confirmed.amount = 500;
      book.open = 1_000;
      await expect(
        service.approve('WD-000001', 'ho@k.com'),
      ).rejects.toMatchObject({ response: { error: 'NOT_ENOUGH_BALANCE' } });
      expect(repo.transition).not.toHaveBeenCalled();
    });

    it('reads the partner fresh and refuses what the request would refuse', async () => {
      partner.is_active = false;
      await expect(
        service.approve('WD-000001', 'ho@k.com'),
      ).rejects.toMatchObject({
        status: 403,
        response: { error: 'PARTNER_NOT_APPROVED' },
      });
      expect(commission.forget).toHaveBeenCalledWith('VST-000001');

      partner.is_active = true;
      facts.bank_change_pending = true;
      await expect(
        service.approve('WD-000001', 'ho@k.com'),
      ).rejects.toMatchObject({ response: { error: 'BANK_CHANGE_PENDING' } });
      expect(repo.transition).not.toHaveBeenCalled();
    });

    it('refuses a withdrawal that is not waiting for approval', async () => {
      repo.findById.mockResolvedValue(withdrawal({ status: 'paid' }));
      await expect(
        service.approve('WD-000001', 'ho@k.com'),
      ).rejects.toMatchObject({ response: { error: 'WITHDRAWAL_CHANGED' } });
    });
  });

  it('lets the partner cancel only before approval', async () => {
    repo.transition.mockResolvedValueOnce(withdrawal({ status: 'cancelled' }));
    await expect(
      service.cancel('VST-000001', 'WD-000001'),
    ).resolves.toMatchObject({ status: 'cancelled' });
    expect(repo.transition).toHaveBeenCalledWith(
      'WD-000001',
      ['requested'],
      'cancelled',
      expect.any(Object),
      'VST-000001',
    );

    repo.transition.mockResolvedValueOnce(null);
    repo.findById.mockResolvedValue(withdrawal({ status: 'approved' }));
    await expect(
      service.cancel('VST-000001', 'WD-000001'),
    ).rejects.toMatchObject({ response: { error: 'WITHDRAWAL_CHANGED' } });
  });

  it('writes the bank file for approved withdrawals, leaving out any without an account', async () => {
    repo.all.mockResolvedValue([
      withdrawal({ status: 'approved', net_amount: 980 }),
      withdrawal({
        _id: 'WD-000002',
        agent_id: 'VST-000404',
        status: 'approved',
      }),
    ]);
    const file = await service.payoutFile();
    expect(file.rows).toBe(1);
    expect(file.total_net).toBe(980);
    expect(file.skipped).toEqual([
      expect.objectContaining({ id: 'WD-000002', agent_id: 'VST-000404' }),
    ]);
    const [, line] = file.content.trim().split('\n');
    expect(line).toContain('000123454321,SBIN0001234,1000.00,20.00,980.00');
    // A name that looks like a formula is not run by the spreadsheet.
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('leaves out of the bank file an account not verified, under change, or not the approved one', async () => {
    repo.all.mockResolvedValue([withdrawal({ status: 'approved' })]);
    const reasonOf = async () => {
      const file = await service.payoutFile();
      expect(file.rows).toBe(0);
      return file.skipped[0]?.reason;
    };

    facts.bank_verified = false;
    expect(await reasonOf()).toMatch(/not verified/);
    facts.bank_verified = true;
    facts.bank_change_pending = true;
    expect(await reasonOf()).toMatch(/change is waiting/);
    facts.bank_change_pending = false;
    facts.bank_account = { ...facts.bank_account!, account_number: '99998888' };
    expect(await reasonOf()).toMatch(/changed after approval/);
  });

  it('marks each line of a paid batch on its own', async () => {
    repo.transition
      .mockResolvedValueOnce(withdrawal({ status: 'paid' }))
      .mockResolvedValueOnce(null);
    const out = await service.payBatch(
      {
        items: [
          { id: 'WD-000001', utr: 'UTR123456' },
          { id: 'WD-000002', utr: 'UTR654321' },
        ],
      },
      'ho@k.com',
    );
    expect(out.paid).toBe(1);
    expect(out.results.map((r) => r.ok)).toEqual([true, false]);
  });

  it('refuses a payment date in the future', async () => {
    await expect(
      service.pay(
        'WD-000001',
        { utr: 'UTR123456', paid_at: '2099-01-01T00:00:00Z' },
        'ho@k.com',
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('csvCell', () => {
  it('quotes commas and quotes, and defuses formulas', () => {
    expect(csvCell('Patel, Ramesh')).toBe('"Patel, Ramesh"');
    expect(csvCell('+911234')).toBe("'+911234");
    expect(csvCell('plain')).toBe('plain');
  });
});
