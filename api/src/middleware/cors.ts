import cors from 'cors'

export function apiCors(frontendUrl: string) {
  const allowedOrigins = frontendUrl.split(',').map((origin) => origin.trim()).filter(Boolean)
  return cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true)
      return callback(new Error(`Origin ${origin} is not allowed`))
    },
  })
}