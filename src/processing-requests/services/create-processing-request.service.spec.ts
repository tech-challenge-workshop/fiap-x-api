import { Test, TestingModule } from '@nestjs/testing';
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
    jest
      .spyOn(catalogClient, 'createProcessingRequest')
      .mockResolvedValue('pr-123');

    const result = await service.execute({
      ownerUserId: 'user-123',
      sourceStorageKey: 'videos/clip.mp4',
    });

    expect(catalogClient.createProcessingRequest).toHaveBeenCalledWith(
      'user-123',
      'videos/clip.mp4',
    );
    expect(result).toEqual({ processingRequestId: 'pr-123' });
  });

  it('propagates catalog client rejection', async () => {
    jest
      .spyOn(catalogClient, 'createProcessingRequest')
      .mockRejectedValue(new Error('Catalog rejected creation'));

    await expect(
      service.execute({
        ownerUserId: 'user-123',
        sourceStorageKey: 'videos/clip.mp4',
      }),
    ).rejects.toThrow('Catalog rejected creation');
  });
});
