import { ValidateBy, ValidationArguments } from 'class-validator';

export const MAX_SOURCE_BYTES = 524_288_000;

const CONTENT_TYPES = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
} as const;

type VideoExtension = keyof typeof CONTENT_TYPES;

/** The lowercase extension of an accepted file name, or `undefined`. */
export function videoExtensionOf(
  fileName: unknown,
): VideoExtension | undefined {
  if (typeof fileName !== 'string' || fileName.length > 255) {
    return undefined;
  }
  const match = /^.+\.(mp4|mov)$/i.exec(fileName);
  return match ? (match[1].toLowerCase() as VideoExtension) : undefined;
}

/**
 * `contentType` must be the one its extension implies, ignoring case (media
 * types are case-insensitive). The whole value is compared, so a type with
 * parameters fails. When `fileName` is itself invalid only that field is
 * named, so any accepted type passes here.
 */
function matchesExtension(value: unknown, args: ValidationArguments): boolean {
  const extension = videoExtensionOf(
    (args.object as { fileName?: unknown }).fileName,
  );
  const accepted: readonly string[] = extension
    ? [CONTENT_TYPES[extension]]
    : Object.values(CONTENT_TYPES);
  return typeof value === 'string' && accepted.includes(value.toLowerCase());
}

/** One constraint per field, so an invalid field yields exactly one message. */
export class StartUploadDto {
  @ValidateBy(
    {
      name: 'isVideoFileName',
      validator: { validate: (value) => videoExtensionOf(value) !== undefined },
    },
    {
      message:
        'fileName must be at most 255 characters and end in .mp4 or .mov',
    },
  )
  fileName: string;

  @ValidateBy(
    { name: 'matchesExtension', validator: { validate: matchesExtension } },
    {
      message:
        'contentType must be video/mp4 for .mp4 or video/quicktime for .mov',
    },
  )
  contentType: string;

  @ValidateBy(
    {
      name: 'isSourceSize',
      validator: {
        validate: (value) =>
          Number.isSafeInteger(value) &&
          (value as number) >= 1 &&
          (value as number) <= MAX_SOURCE_BYTES,
      },
    },
    {
      message: `sizeBytes must be an integer between 1 and ${MAX_SOURCE_BYTES}`,
    },
  )
  sizeBytes: number;
}
