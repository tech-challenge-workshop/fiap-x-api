import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateProcessingRequestDto {
  /**
   * Never read: the owner is the token's `sub` (AC P2.2). Declared only so
   * that `forbidNonWhitelisted` ignores it instead of answering 400.
   */
  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @IsString()
  @IsNotEmpty()
  sourceStorageKey: string;
}
