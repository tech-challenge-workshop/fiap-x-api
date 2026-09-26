import { Transform } from 'class-transformer';
import { ValidateBy } from 'class-validator';

/** Only a plain digit string becomes a number; anything else fails the range check. */
const digitsToNumber = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

/** One constraint, so an invalid value yields exactly one message. */
function IsIntegerBetween(min: number, max: number, message: string) {
  return ValidateBy(
    {
      name: 'isIntegerBetween',
      validator: {
        validate: (value: unknown) =>
          Number.isSafeInteger(value) &&
          (value as number) >= min &&
          (value as number) <= max,
      },
    },
    { message },
  );
}

/** The same bounds and messages as the Catalog's owner-scoped list. */
export class ListQueryDto {
  @Transform(digitsToNumber)
  @IsIntegerBetween(
    1,
    Number.MAX_SAFE_INTEGER,
    'page must be an integer greater than or equal to 1',
  )
  page: number = 1;

  @Transform(digitsToNumber)
  @IsIntegerBetween(1, 100, 'pageSize must be an integer between 1 and 100')
  pageSize: number = 20;
}
