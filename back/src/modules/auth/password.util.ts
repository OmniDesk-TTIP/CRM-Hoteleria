import { compare, hash } from 'bcryptjs';

const DUMMY_HASH = '$2b$10$4wfpEu5JuU2OmrYouCqNzOHiCcNSywzYfUbUUfnKGt8GE09Pc9uiG';

export function hashPassword(plain: string, saltRounds: number): Promise<string> {
  return hash(plain, saltRounds);
}

export function verifyPassword(plain: string, passwordHash: string): Promise<boolean> {
  return compare(plain, passwordHash);
}

export async function burnPasswordComparison(plain: string): Promise<void> {
  await compare(plain, DUMMY_HASH).catch(() => false);
}
