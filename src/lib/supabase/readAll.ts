/** Page through a deterministically ordered query; never treat failed pages as empty data. */
export async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const result: T[] = []
  for (let from = 0; ; from += 500) {
    const r = await page(from, from + 499)
    if (r.error) throw new Error(`Data could not be loaded: ${r.error.message}`)
    result.push(...(r.data ?? []))
    if ((r.data?.length ?? 0) < 500) return result
  }
}
