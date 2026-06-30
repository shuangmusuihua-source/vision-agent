import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { readJsonlTailPage } from '../src/main/jsonl-tail-reader'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('readJsonlTailPage', () => {
  it('reads newest pages backward without parsing the whole file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vision-jsonl-'))
    tempDirs.push(dir)
    const file = join(dir, 'session.jsonl')
    const rows = Array.from({ length: 25 }, (_, index) => JSON.stringify({ index }))
    await writeFile(file, `${rows.join('\n')}\n`)

    const newest = await readJsonlTailPage(file, 10, 0, 32)
    expect(newest.records.map(row => row.index)).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23, 24])
    expect(newest.hasMore).toBe(true)

    const older = await readJsonlTailPage(file, 10, newest.offset, 32)
    expect(older.records.map(row => row.index)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    expect(older.hasMore).toBe(true)

    const oldest = await readJsonlTailPage(file, 10, older.offset, 32)
    expect(oldest.records.map(row => row.index)).toEqual([0, 1, 2, 3, 4])
    expect(oldest.hasMore).toBe(false)
    expect(oldest.offset).toBe(0)
  })

  it('skips malformed lines while keeping the cursor moving', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vision-jsonl-'))
    tempDirs.push(dir)
    const file = join(dir, 'session.jsonl')
    await writeFile(file, '{"index":0}\nnot-json\n{"index":2}')

    const page = await readJsonlTailPage(file, 3, 0, 8)
    expect(page.records.map(row => row.index)).toEqual([0, 2])
    expect(page.hasMore).toBe(false)
  })

  it('preserves multibyte JSON across one-byte chunk boundaries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vision-jsonl-'))
    tempDirs.push(dir)
    const file = join(dir, 'session.jsonl')
    const rows = Array.from({ length: 7 }, (_, index) => JSON.stringify({ index, text: `第${index}条` }))
    await writeFile(file, rows.join('\n'))

    const newest = await readJsonlTailPage(file, 4, 0, 1)
    expect(newest.records).toEqual([
      { index: 3, text: '第3条' },
      { index: 4, text: '第4条' },
      { index: 5, text: '第5条' },
      { index: 6, text: '第6条' },
    ])

    const oldest = await readJsonlTailPage(file, 4, newest.offset, 1)
    expect(oldest.records).toEqual([
      { index: 0, text: '第0条' },
      { index: 1, text: '第1条' },
      { index: 2, text: '第2条' },
    ])
    expect(oldest.hasMore).toBe(false)
  })
})
