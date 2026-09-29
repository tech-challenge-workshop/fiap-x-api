import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { RejectedUploadMetricFilter } from './start-upload.service';
import { apiMetrics } from '../observability/metrics';

function httpHost(response: {
  status: jest.Mock;
  json: jest.Mock;
}): ArgumentsHost {
  return {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
}

describe('RejectedUploadMetricFilter', () => {
  const filter = new RejectedUploadMetricFilter();

  beforeEach(() => {
    apiMetrics.resetMetrics();
  });

  afterEach(() => {
    apiMetrics.resetMetrics();
  });

  it('counts a rejected start exactly once, without touching accepted', async () => {
    const exception = new BadRequestException({
      message: ['sizeBytes must be an integer between 1 and 524288000'],
      error: 'Bad Request',
      statusCode: 400,
    });
    const response = { status: jest.fn(), json: jest.fn() };
    response.status.mockReturnValue(response);

    filter.catch(exception, httpHost(response));

    const exposition = await apiMetrics.metrics();
    expect(exposition).toContain('fiapx_uploads_total{outcome="rejected"} 1');
    expect(exposition).not.toContain('outcome="accepted"');
  });

  it('keeps the controller error contract through the delegate filter', () => {
    const messages = [
      'contentType must be video/mp4 for .mp4 or video/quicktime for .mov',
    ];
    const exception = new BadRequestException(messages);
    const response = { status: jest.fn(), json: jest.fn() };
    response.status.mockReturnValue(response);

    filter.catch(exception, httpHost(response));

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 400,
      message: messages,
    });
  });

  it('catches BadRequestException only', () => {
    const caught: unknown = Reflect.getMetadata(
      '__filterCatchExceptions__',
      RejectedUploadMetricFilter,
    );

    expect(caught).toEqual([BadRequestException]);
  });
});
