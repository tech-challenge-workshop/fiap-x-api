import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateProcessingRequestDto } from './create-processing-request.dto';

describe('CreateProcessingRequestDto', () => {
  it('accepts valid input', async () => {
    const dto = plainToInstance(CreateProcessingRequestDto, {
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/clip.mp4',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects missing ownerUserId', async () => {
    const dto = plainToInstance(CreateProcessingRequestDto, {
      sourceStorageKey: 'videos/clip.mp4',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('ownerUserId');
  });

  it('rejects empty ownerUserId', async () => {
    const dto = plainToInstance(CreateProcessingRequestDto, {
      ownerUserId: '',
      sourceStorageKey: 'videos/clip.mp4',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('ownerUserId');
  });

  it('rejects missing sourceStorageKey', async () => {
    const dto = plainToInstance(CreateProcessingRequestDto, {
      ownerUserId: 'user-123',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('sourceStorageKey');
  });

  it('rejects empty sourceStorageKey', async () => {
    const dto = plainToInstance(CreateProcessingRequestDto, {
      ownerUserId: 'user-123',
      sourceStorageKey: '',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('sourceStorageKey');
  });

  it('rejects missing both fields', async () => {
    const dto = plainToInstance(CreateProcessingRequestDto, {});

    const errors = await validate(dto);

    expect(errors).toHaveLength(2);
  });
});
