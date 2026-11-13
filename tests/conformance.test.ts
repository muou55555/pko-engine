/** 与 pko-vault 的知识管理规范一致性：目录、模板、MOC、技能流程。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SEED_FILES, STANDARD_DIRS } from '../packages/core/src/scaffold.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKILLS = join(ROOT, 'packages', 'skills')

/** 参考库 pko-vault 的顶层目录。 */
const TOP_DIRS = [
  '00-Inbox', '10-Atlas', '20-Projects', '30-Areas', '40-Resources', '50-Wiki',
  '60-Outputs', '70-Calendar', '80-Cards', '90-Archive', '_attachments', '_templates', 'brain', '.raw',
]

/** 参考库的子目录。 */
const SUB_DIRS = [
  '20-Projects/work', '20-Projects/personal',
  '30-Areas/work', '30-Areas/work/company', '30-Areas/work/llm', '30-Areas/work/quant', '30-Areas/work/tech-share',
  '30-Areas/life', '30-Areas/life/community', '30-Areas/life/fitness', '30-Areas/life/travel',
  '30-Areas/life/smart-home', '30-Areas/life/daily-life',
  '40-Resources/concepts', '40-Resources/how-to', '40-Resources/references', '40-Resources/clips',
  '60-Outputs/articles', '60-Outputs/canvases', '60-Outputs/presentations', '60-Outputs/weekly-reports',
  '70-Calendar/daily', '70-Calendar/weekly', '70-Calendar/monthly',
  '_attachments/images', '_attachments/images/canvas', '_attachments/pdfs', '_attachments/pdfs/canvas',
]

/** 参考库的模板。 */
const TEMPLATES = [
  '_templates/article.md', '_templates/book-note.md', '_templates/daily-note.md', '_templates/meeting.md',
  '_templates/project.md', '_templates/weekly-note.md', '_templates/wiki-page.md', '_templates/zettelkasten-card.md',
]

/** 参考库的 MOC。 */
const MOCS = [
  '10-Atlas/HOME.md', '10-Atlas/moc-work.md', '10-Atlas/moc-life.md', '10-Atlas/moc-llm.md',
  '10-Atlas/moc-quant.md', '10-Atlas/moc-tech-share.md', '10-Atlas/moc-community.md',
  '10-Atlas/moc-fitness.md', '10-Atlas/moc-travel.md', '10-Atlas/moc-smart-home.md',
]

/** 读一个技能文件。 */
async function skill(name: string): Promise<string> {
  return readFile(join(SKILLS, name, 'SKILL.md'), 'utf8')
}

test('规范：参考库的每个目录都在初始化骨架里', () => {
  const all = new Set(STANDARD_DIRS)
  for (const dir of [...TOP_DIRS, ...SUB_DIRS]) {
    assert.ok(all.has(dir), `骨架缺少参考库目录：${dir}`)
  }
})

test('规范：八套模板与十个 MOC 都会生成', () => {
  const files = new Set(Object.keys(SEED_FILES))
  for (const template of TEMPLATES) assert.ok(files.has(template), `缺少模板：${template}`)
  for (const moc of MOCS) assert.ok(files.has(moc), `缺少 MOC：${moc}`)
})

test('规范：AGENTS.md 写进了目录、命名、路由与安全规则', () => {
  const agents = SEED_FILES['AGENTS.md'] ?? ''
  for (const keyword of ['目录结构', '文件命名规范', '写入路由', '安全规则', '检索顺序', '00-Inbox', '.raw/', '90-Archive/']) {
    assert.ok(agents.includes(keyword), `AGENTS.md 缺少：${keyword}`)
  }
})

test('规范：每个技能都覆盖它在 vault 里对应的流程', async () => {
  const expectations: Array<[string, string[]]> = [
    ['pko-ingest', ['00-Inbox', '.raw/YYYY-MM-DD-', '50-Wiki/index.md', '10-Atlas/moc-', '_templates/wiki-page.md', '⚠️ 待确认', '[[链接]]']],
    ['pko-save', ['40-Resources/how-to/', '40-Resources/concepts/', '80-Cards/', '20-Projects/work/', '30-Areas/work/llm/', '30-Areas/work/quant/', '30-Areas/life/', '70-Calendar/daily/', '10-Atlas/moc-']],
    ['pko-daily', ['brain/north-star.md', '50-Wiki/hot.md', '70-Calendar/daily/', '_templates/daily-note.md', '00-Inbox', '20-Projects/work/', 'status: active']],
    ['pko-query', ['50-Wiki/hot.md', '50-Wiki/index.md', '10-Atlas/HOME.md', '10-Atlas/moc-', 'vault 中暂无此内容']],
    ['pko-weekly', ['70-Calendar/daily/', '20-Projects/', '50-Wiki/log.md', '60-Outputs/weekly-reports/', '70-Calendar/weekly/']],
    ['pko-moc', ['40-Resources/', '30-Areas/', '20-Projects/', '10-Atlas/moc-', 'MOC 覆盖率', '孤立']],
    ['pko-wrap-up', ['70-Calendar/daily/', '50-Wiki/hot.md', 'brain/', '00-Inbox']],
    ['pko-canvas', ['60-Outputs/canvases/', '_attachments/images/canvas/', '_attachments/pdfs/canvas/']],
    ['pko-setup', ['node --version', 'dsh --version', 'pko_init', 'plan: true', 'pko_status', '不要自动创建']],
  ]
  for (const [name, keywords] of expectations) {
    const text = await skill(name)
    for (const keyword of keywords) {
      assert.ok(text.includes(keyword), `${name} 缺少流程要素：${keyword}`)
    }
  }
})

test('规范：技能都是人类命令（不自动触发），共 9 个', async () => {
  for (const name of ['pko-setup', 'pko-ingest', 'pko-save', 'pko-daily', 'pko-query', 'pko-weekly', 'pko-moc', 'pko-wrap-up', 'pko-canvas']) {
    const text = await skill(name)
    assert.match(text, /user-invocable: true/, `${name} 应可被用户调用`)
    assert.match(text, /disable-model-invocation: true/, `${name} 不应自动触发`)
  }
})
