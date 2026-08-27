import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import {
  CreateProcessingRequestService,
  CATALOG_CLIENT,
} from './create-processing-request.service';
import { CatalogClient } from '../ports/catalog-client.port';

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

  it('delegates creation to catalog client and returns id', async () => {
    const createProcessingRequestSpy = jest
      .spyOn(catalogClient, 'createProcessingRequest')
      .mockResolvedValue('pr-123');

    const result = await service.execute({
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/clip.mp4',
    });

    expect(createProcessingRequestSpy).toHaveBeenCalledWith(
      'user-123',
      'videos/clip.mp4',
    );
    expect(result).toEqual({ processingRequestId: 'pr-123' });
  });

  it('maps catalog client rejection to HTTP 502', async () => {
    jest
      .spyOn(catalogClient, 'createProcessingRequest')
      .mockRejectedValue(new Error('Catalog rejected creation'));

    await expect(
      service.execute({
        ownerUserId: 'user-123',
        sourceStorageKey: 'videos/clip.mp4',
      }),
    ).rejects.toMatchObject(
      new HttpException('Catalog rejected creation', HttpStatus.BAD_GATEWAY),
    );
  });
});
