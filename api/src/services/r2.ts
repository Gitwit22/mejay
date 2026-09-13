import {GetObjectCommand, S3Client} from '@aws-sdk/client-s3'

export function createDownloadsBucket(env: NodeJS.ProcessEnv) {
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
  }
}