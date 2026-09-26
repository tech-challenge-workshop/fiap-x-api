import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import {
  CreateProcessingRequestService,
  CATALOG_CLIENT,
} from './create-processing-request.service';
import { CatalogClient } from '../ports/catalog-client.port';
import { CatalogUnavailableError } from '../errors/catalog-unavailable.error';

describe('CreateProcessingRequestService', () => {
  let service: CreateProcessingRequestService;
  let catalogClient: CatalogClient;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreateProcessingRequestService,
        {
          provide: CATALOG_CLIENT,
          useValue: {
            createProcessingRequest: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CreateProcessingRequestService>(
      CreateProcessingRequestService,
    );
    catalogClient = module.get<CatalogClient>(CATALOG_CLIENT);
  });

  it('delegates creation to catalog client and returns the response', async () => {
    const createProcessingRequestSpy = jest
      .spyOn(catalogClient, 'createProcessingRequest')
      .mockResolvedValue({
        outcome: 'created',
        processingRequestId: 'pr-123',
        status: 'RECEIVED',
      });

    const result = await service.execute('alice', {
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/clip.mp4',
    });

    expect(createProcessingRequestSpy).toHaveBeenCalledWith(
      'alice',
      'videos/clip.mp4',
      expect.any(String),
    );
    expect(result).toEqual({
      processingRequestId: 'pr-123',
      status: 'RECEIVED',
    });
  });

  it('maps CatalogUnavailableError to HTTP 502', async () => {
    jest
      .spyOn(catalogClient, 'createProcessingRequest')
      .mockRejectedValue(new CatalogUnavailableError());

    try {
      await service.execute('alice', {
        ownerUserId: 'user-123',
        sourceStorageKey: 'videos/clip.mp4',
      });
      fail('expected HttpException');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const httpException = error as HttpException;
      expect(httpException.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
      expect(httpException.message).toBe('Catalog unavailable');
    }
  });

  it('lets unexpected errors propagate as HTTP 500', async () => {
    jest
      .spyOn(catalogClient, 'createProcessingRequest')
      .mockRejectedValue(new Error('unexpected boom'));

    await expect(
      service.execute('alice', {
        ownerUserId: 'user-123',
        sourceStorageKey: 'videos/clip.mp4',
      }),
    ).rejects.toThrow('unexpected boom');
  });
});
