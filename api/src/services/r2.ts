import {DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client} from '@aws-sdk/client-s3'
import {getSignedUrl} from '@aws-sdk/s3-request-presigner'

export type PrivateBucket = {
  get: (defaultKey: string) => Promise<{body: ReadableStream} | null>
  createUploadUrl: (key: string, contentType: string, byteSize: number) => Promise<string>
  head: (key: string) => Promise<{contentType: string | undefined; byteSize: number | undefined} | null>
  delete: (key: string) => Promise<void>
}

export function createDownloadsBucket(env: NodeJS.ProcessEnv): PrivateBucket | undefined {
  const accountId = env.R2_ACCOUNT_ID
  const accessKeyId = env.R2_ACCESS_KEY_ID
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY
  const bucket = env.R2_BUCKET_NAME

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return undefined

  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {accessKeyId, secretAccessKey},
  })

  return {
    async get(defaultKey: string) {
      try {
        const response = await client.send(new GetObjectCommand({Bucket: bucket, Key: env.R2_DOWNLOAD_KEY || defaultKey}))
        if (!response.Body) return null
        return {body: response.Body.transformToWebStream()}
      } catch (error: any) {
        if (error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null
        throw error
      }
    },
    async createUploadUrl(key: string, contentType: string, byteSize: number) {
      return getSignedUrl(client, new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: byteSize,
      }), {expiresIn: 300})
    },
    async head(key: string) {
      try {
        const response = await client.send(new HeadObjectCommand({Bucket: bucket, Key: key}))
        return {contentType: response.ContentType, byteSize: response.ContentLength}
      } catch (error: any) {
        if (error?.name === 'NotFound' || error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404) return null
        throw error
      }
    },
    async delete(key: string) {
      await client.send(new DeleteObjectCommand({Bucket: bucket, Key: key}))
    },
  }
}