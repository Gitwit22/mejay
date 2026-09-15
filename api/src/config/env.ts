export type CookieSameSite = 'lax' | 'none' | 'strict'

export type AppConfig = NodeJS.ProcessEnv & {
  NODE_ENV: 'development' | 'test' | 'production'
  PORT: string
  DATABASE_URL: string
  FRONTEND_URL: string
  SESSION_PEPPER: string
  AUTH_CODE_PEPPER: string
  AUTH_TOKEN_SECRET: string
  COOKIE_SAME_SITE: CookieSameSite
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  STRIPE_PRICE_PRO: string
  STRIPE_PRICE_YEARLY: string
  STRIPE_PRICE_FULL_PROGRAM: string
  ISRC_PREFIX: string
  ISRC_COUNTRY_CODE: string
  ISRC_REGISTRANT_CODE: string
}

import {readIsrcGenerationConfig} from '../marketplace/isrc'

const developmentSecrets = {
  SESSION_PEPPER: 'dev-session-pepper',
  AUTH_CODE_PEPPER: 'dev-auth-code-pepper',
  AUTH_TOKEN_SECRET: 'dev-auth-token-secret',
} as const

function requireValue(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim()
  if (!value) throw new Error(`Missing required environment variable: ${key}`)
  return value
}

function parseSameSite(value: string | undefined): CookieSameSite {
  const normalized = value?.trim().toLowerCase() || 'lax'
  if (normalized === 'lax' || normalized === 'none' || normalized === 'strict') return normalized
  throw new Error('COOKIE_SAME_SITE must be lax, none, or strict')
}

function validateUrl(value: string, key: string): string {
  try {
    return new URL(value).origin
  } catch {
    throw new Error(`${key} must be a valid absolute URL`)
  }
}

function productionSecret(env: NodeJS.ProcessEnv, key: keyof typeof developmentSecrets): string {
  const value = requireValue(env, key)
  if (value.length < 32 || value === developmentSecrets[key] || value.startsWith('replace-with-')) {
    throw new Error(`${key} must be a non-placeholder secret of at least 32 characters`)
  }
  return value
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV === 'production' || env.NODE_ENV === 'test' ? env.NODE_ENV : 'development'
  const production = nodeEnv === 'production'
  const sameSite = parseSameSite(env.COOKIE_SAME_SITE)
  const isrc = readIsrcGenerationConfig(env)

  if (sameSite === 'none' && !production && env.COOKIE_SECURE !== 'true') {
    throw new Error('COOKIE_SAME_SITE=none requires secure cookies')
  }

  const config: AppConfig = {
    ...env,
    NODE_ENV: nodeEnv,
    PORT: env.PORT?.trim() || '4000',
    DATABASE_URL: requireValue(env, 'DATABASE_URL'),
    FRONTEND_URL: env.FRONTEND_URL?.trim() || 'http://localhost:8080',
    SESSION_PEPPER: production ? productionSecret(env, 'SESSION_PEPPER') : env.SESSION_PEPPER?.trim() || developmentSecrets.SESSION_PEPPER,
    AUTH_CODE_PEPPER: production ? productionSecret(env, 'AUTH_CODE_PEPPER') : env.AUTH_CODE_PEPPER?.trim() || developmentSecrets.AUTH_CODE_PEPPER,
    AUTH_TOKEN_SECRET: production ? productionSecret(env, 'AUTH_TOKEN_SECRET') : env.AUTH_TOKEN_SECRET?.trim() || developmentSecrets.AUTH_TOKEN_SECRET,
    COOKIE_SAME_SITE: sameSite,
    STRIPE_SECRET_KEY: production ? requireValue(env, 'STRIPE_SECRET_KEY') : env.STRIPE_SECRET_KEY?.trim() || '',
    STRIPE_WEBHOOK_SECRET: production ? requireValue(env, 'STRIPE_WEBHOOK_SECRET') : env.STRIPE_WEBHOOK_SECRET?.trim() || '',
    STRIPE_PRICE_PRO: production ? requireValue(env, 'STRIPE_PRICE_PRO') : env.STRIPE_PRICE_PRO?.trim() || '',
    STRIPE_PRICE_YEARLY: production ? requireValue(env, 'STRIPE_PRICE_YEARLY') : env.STRIPE_PRICE_YEARLY?.trim() || '',
    STRIPE_PRICE_FULL_PROGRAM: production
      ? requireValue(env, 'STRIPE_PRICE_FULL_PROGRAM')
      : env.STRIPE_PRICE_FULL_PROGRAM?.trim() || '',
    ISRC_PREFIX: isrc?.prefix ?? '',
    ISRC_COUNTRY_CODE: isrc?.countryCode ?? '',
    ISRC_REGISTRANT_CODE: isrc?.registrantCode ?? '',
  }

  config.FRONTEND_URL = config.FRONTEND_URL
    .split(',')
    .map((value) => validateUrl(value.trim(), 'FRONTEND_URL'))
    .join(',')

  if (!Number.isInteger(Number(config.PORT)) || Number(config.PORT) <= 0) throw new Error('PORT must be a positive integer')
  if (production && sameSite === 'none' && env.COOKIE_SECURE === 'false') {
    throw new Error('COOKIE_SAME_SITE=none cannot be used with COOKIE_SECURE=false')
  }

  return config
}