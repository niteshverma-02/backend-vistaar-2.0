import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class UploadQueryDto {
  @ApiProperty({
    example: 'aadhaar_front',
    description: 'The form field this file is for (letters, digits, _)',
  })
  @Matches(/^[a-z][a-z0-9_]{1,60}$/, {
    message:
      'This upload is not linked to a form field. Please reopen the form and try again.',
  })
  purpose!: string;
}

export class UploadedDto {
  @ApiProperty({
    example: 'vistaar/VST-000001/aadhaar_front/3f1c….jpg',
    description: 'Store this in the form value',
  })
  path!: string;
  @ApiProperty({ description: 'Signed preview URL, valid one hour' })
  url!: string | null;
  @ApiProperty({ example: 'image/jpeg' })
  content_type!: string;
  @ApiProperty({ example: 182344 })
  size!: number;
}
