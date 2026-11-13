/** 还原点：创建、列出、恢复，且不污染工作分支。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { createCheckpoint, isGitRepo, listCheckpoints, restoreCheckpoint } from '../packages/core/src/checkpoint.ts'

const run = promisify(execFile)

/** 建一个已提交一版的 git 仓库。 */
async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'pko-ckpt-'))
  const git = (args: string[]): Promise<unknown> => run('git', ['-C', dir, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
  await git(['init', '-q'])
  await writeFile(join(dir, 'a.md'), 'v1\n')
  await git(['add', '-A'])
  await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'])
  return dir
}

test('还原点：非 git 目录拒绝创建', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pko-nogit-'))
  assert.equal(await isGitRepo(dir), false)
  await assert.rejects(() => createCheckpoint(dir), /不是 git 仓库/)
})

test('还原点：创建工作区快照且不改变当前状态', async () => {
  const repo = await makeRepo()
  await writeFile(join(repo, 'a.md'), 'v2 未提交\n')
  const checkpoint = await createCheckpoint(repo, new Date('2026-05-01T10:20:30Z'))
  assert.equal(checkpoint.id, '20260501-102030')
  // 工作区仍是 v2，checkpoint 没有回滚或暂存
  assert.equal(await readFile(join(repo, 'a.md'), 'utf8'), 'v2 未提交\n')
})

test('还原点：列出与恢复', async () => {
  const repo = await makeRepo()
  await writeFile(join(repo, 'a.md'), 'checkpoint 时的内容\n')
  const checkpoint = await createCheckpoint(repo, new Date('2026-05-01T10:20:30Z'))

  await writeFile(join(repo, 'a.md'), '后来的改动\n')

  const listed = await listCheckpoints(repo)
  assert.equal(listed.length, 1)
  assert.equal(listed[0]?.id, checkpoint.id)

  await restoreCheckpoint(repo, checkpoint.id)
  assert.equal(await readFile(join(repo, 'a.md'), 'utf8'), 'checkpoint 时的内容\n')
})

test('还原点：恢复不存在的 id 报错', async () => {
  const repo = await makeRepo()
  await assert.rejects(() => restoreCheckpoint(repo, '19990101-000000'), /找不到还原点/)
})
