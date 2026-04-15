import { createHmac, randomBytes } from 'node:crypto';
import { generatePin } from './utils';

// Helper functions for base64url encoding/decoding
function base64urlEncode(data: string | Buffer): string {
	const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
	return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str: string): string {
	let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
	while (base64.length % 4) {
		base64 += '=';
	}
	return Buffer.from(base64, 'base64').toString();
}

// JWT types
interface JwtHeader {
	alg: string;
	typ: string;
}

interface JwtPayload {
	ip: string;
	iat: number;
	exp: number;
}

interface VerifyResult {
	valid: boolean;
	payload?: JwtPayload;
	error?: string;
}

interface RateLimitResult {
	allowed: boolean;
	retryAfter?: number;
}

// Rate limit state
interface RateLimitEntry {
	attempts: number;
	lockedUntil?: number;
}

/**
 * Creates an authentication manager with PIN, JWT tokens, and rate limiting.
 */
export function createAuth() {
	let pin: string = generatePin();
	const jwtSecret: string = randomBytes(32).toString('hex');

	const rateLimitMap = new Map<string, RateLimitEntry>();

	const MAX_ATTEMPTS = 3;
	const COOLDOWN_SECONDS = 30;
	const TOKEN_EXPIRY_SECONDS = 86400; // 24 hours

	function createToken(ip: string): string {
		const header: JwtHeader = { alg: 'HS256', typ: 'JWT' };
		const now = Math.floor(Date.now() / 1000);

		const payload: JwtPayload = {
			ip,
			iat: now,
			exp: now + TOKEN_EXPIRY_SECONDS,
		};

		const headerEncoded = base64urlEncode(JSON.stringify(header));
		const payloadEncoded = base64urlEncode(JSON.stringify(payload));
		const signatureInput = `${headerEncoded}.${payloadEncoded}`;

		const signature = createHmac('sha256', jwtSecret)
			.update(signatureInput)
			.digest();

		const signatureEncoded = base64urlEncode(signature);

		return `${headerEncoded}.${payloadEncoded}.${signatureEncoded}`;
	}

	function verifyToken(token: string): VerifyResult {
		const parts = token.split('.');
		if (parts.length !== 3) {
			return { valid: false, error: 'Invalid token format' };
		}

		const [headerEncoded, payloadEncoded, signatureEncoded] = parts;

		// Verify signature
		const signatureInput = `${headerEncoded}.${payloadEncoded}`;
		const expectedSignature = createHmac('sha256', jwtSecret)
			.update(signatureInput)
			.digest();

		const expectedSignatureEncoded = base64urlEncode(expectedSignature);

		if (signatureEncoded !== expectedSignatureEncoded) {
			return { valid: false, error: 'Invalid signature' };
		}

		// Decode and validate payload
		try {
			const payload: JwtPayload = JSON.parse(base64urlDecode(payloadEncoded));

			const now = Math.floor(Date.now() / 1000);
			if (payload.exp <= now) {
				return { valid: false, error: 'Token expired' };
			}

			return { valid: true, payload };
		} catch {
			return { valid: false, error: 'Invalid payload' };
		}
	}

	function checkRateLimit(ip: string): RateLimitResult {
		const entry = rateLimitMap.get(ip);
		const now = Math.floor(Date.now() / 1000);

		if (!entry) {
			return { allowed: true };
		}

		// Check if currently locked
		if (entry.lockedUntil) {
			if (now < entry.lockedUntil) {
				return {
					allowed: false,
					retryAfter: entry.lockedUntil - now,
				};
			}
			// Lock expired, reset
			rateLimitMap.delete(ip);
			return { allowed: true };
		}

		// Check if exceeded max attempts in current window
		if (entry.attempts >= MAX_ATTEMPTS) {
			entry.lockedUntil = now + COOLDOWN_SECONDS;
			return {
				allowed: false,
				retryAfter: COOLDOWN_SECONDS,
			};
		}

		return { allowed: true };
	}

	function recordFailedAttempt(ip: string): void {
		const entry = rateLimitMap.get(ip);
		if (!entry) {
			rateLimitMap.set(ip, { attempts: 1 });
		} else if (!entry.lockedUntil) {
			entry.attempts++;
		}
		// If locked, do nothing (counter stays frozen during lockout)
	}

	function resetRateLimit(ip: string): void {
		rateLimitMap.delete(ip);
	}

	function regeneratePin(): string {
		pin = generatePin();
		return pin;
	}

	return {
		get pin(): string {
			return pin;
		},
		jwtSecret,
		createToken,
		verifyToken,
		checkRateLimit,
		recordFailedAttempt,
		resetRateLimit,
		regeneratePin,
	};
}

// Export the return type
export type Auth = ReturnType<typeof createAuth>;
