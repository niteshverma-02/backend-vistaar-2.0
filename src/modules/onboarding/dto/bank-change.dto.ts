import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class BankChangeDto {
  @ApiProperty({
    example: 'Suresh Kumar',
    description: 'As printed on the cheque or passbook',
  })
  @IsString()
  @MaxLength(100)
  account_holder!: string;

  @ApiProperty({ example: '000123454321', description: '9 to 18 digits' })
  @Matches(/^\d{9,18}$/, {
    message: 'The account number must be 9 to 18 digits.',
  })
  account_number!: string;

  @ApiProperty({ example: 'SBIN0001234' })
  @Matches(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, {
    message: 'The IFSC is not correct. Please check it.',
  })
  ifsc!: string;

  @ApiProperty({
    example: 'KO-documents/PII-9/bank/1760000000000-ab12.jpg',
    description:
      'Cancelled cheque or passbook photo, as the upload route returned its path — in your own folder',
  })
  @IsString()
  @MaxLength(300)
  proof_path!: string;
}
