import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";

export async function listBucketObjects({ endpoint, bucket, accessKey, secretKey, region = "us-east-1" }) {
  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
  });
  const keys = [];
  let continuationToken;

  try {
    for (let page = 0; page < 10; page += 1) {
      const response = await client.send(new ListObjectsV2Command({
        Bucket: bucket,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      }), { abortSignal: AbortSignal.timeout(8000) });
      for (const object of response.Contents || []) {
        if (object.Key) keys.push(object.Key);
      }
      if (!response.IsTruncated) return keys;
      continuationToken = response.NextContinuationToken;
      if (!continuationToken) throw new Error("Resposta MinIO sem token para a próxima página.");
    }
    throw new Error("A listagem MinIO excedeu o limite de páginas permitido.");
  } finally {
    client.destroy();
  }
}
