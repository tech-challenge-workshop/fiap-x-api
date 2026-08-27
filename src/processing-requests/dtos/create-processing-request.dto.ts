import { IsNotEmpty, IsString } from 'class-validator';

export class CreateProcessingRequestDto {
  @IsString()
  @IsNotEmpty()
  ownerUserId: string;

  @IsString()
  @IsNotEmpty()
  sourceStorageKey: string;
}
