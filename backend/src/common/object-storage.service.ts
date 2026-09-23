import { Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
@Injectable()
export class ObjectStorageService {
  private client: S3Client | null = process.env.S3_BUCKET
    ? new S3Client({
        region: process.env.S3_REGION || 'ap-southeast-1',
        ...(process.env.S3_ENDPOINT
          ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }
          : {}),
        ...(process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
          ? {
              credentials: {
                accessKeyId: process.env.S3_ACCESS_KEY,
                secretAccessKey: process.env.S3_SECRET_KEY,
              },
            }
          : {}),
      })
    : null;
  async put(id: string, bytes: Buffer) {
    if (!this.client) return null;
    const key = `careflow/documents/${id}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: 'application/octet-stream',
        ...(process.env.S3_KMS_KEY_ID
          ? { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: process.env.S3_KMS_KEY_ID }
          : {}),
      }),
      { abortSignal: AbortSignal.timeout(15000) },
    );
    return key;
  }
  async get(key: string) {
    if (!this.client) throw new Error('Object storage is not configured');
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
      { abortSignal: AbortSignal.timeout(15000) },
    );
    if (!response.Body) throw new Error('Stored document is unavailable');
    return Buffer.from(await response.Body.transformToByteArray());
  }
  async remove(key: string) {
    if (this.client)
      await this.client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }), {
        abortSignal: AbortSignal.timeout(15000),
      });
  }
}
