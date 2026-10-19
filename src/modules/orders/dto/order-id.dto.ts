import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class IssueOrderIdDto {
  @ApiProperty({
    example: '3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b',
    description:
      'One id per checkout attempt, made by the app. Send the same one on every retry of that attempt — it gets the same order number back.',
  })
  @IsUUID('all', { message: 'request_id must be a UUID.' })
  request_id!: string;
}

export class OrderIdView {
  @ApiProperty({ example: 'KSV-272' })
  order_id!: string;

  @ApiProperty({ example: '3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f809a1b' })
  request_id!: string;

  @ApiProperty({ description: 'When the number was first issued' })
  issued_at!: Date;
}
