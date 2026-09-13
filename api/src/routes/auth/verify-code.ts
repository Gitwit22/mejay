// Alias route for code verification.
// Spec prefers /api/auth/verify-code but older clients may still call /api/auth/verify.
export {onRequest} from './verify'
