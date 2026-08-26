import { neon } from '@neondatabase/serverless';

const databaseUrl = process.env.DATABASE_URL;
const sql = databaseUrl ? neon(databaseUrl) : null;

export function hasDatabase() {
  return Boolean(sql);
}

export async function query<T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  if (!sql) throw new Error('DATABASE_URL is not configured');
  return sql.query(text, params) as Promise<T[]>;
}
